/**
 * Cron cycle: runs every 15 minutes.
 *
 * 1. Purge dead accounts (inactive for 7+ days with no recovery)
 * 2. Compute composite scores (min-max normalization across all traders)
 * 3. Assign sync tiers based on leaderboard rank
 * 4. Re-enqueue stale traders (safety net for lost queue messages)
 * 5. Rebuild KV caches (leaderboard + stats)
 */

import { tierDelaySeconds, tierStaleThresholdSeconds, type SyncTier } from "./tiers";
import {
  setCachedLeaderboard,
  setCachedStats,
  leaderboardCacheKey,
} from "./cache";
import { queryLeaderboard, queryStats } from "./api";
import { dbNow, dbTimeAgo } from "./dates";
import type { SyncMessage, StaleTraderRow, ScoreRangesRow } from "./types";

export async function runCronCycle(env: Env): Promise<void> {
  console.log("[cron] Starting cycle");

  // Each step is isolated so a failure in one doesn't skip the rest.
  // E.g., if composite scores fail, tiers/caches/re-enqueue still run.
  try { await purgeDeadAccounts(env); }
  catch (err) { console.error("[cron] purgeDeadAccounts failed:", err instanceof Error ? err.message : err); }

  try { await computeAndStoreCompositeScores(env); }
  catch (err) { console.error("[cron] computeAndStoreCompositeScores failed:", err instanceof Error ? err.message : err); }

  // Prune old snapshots AFTER scores are computed (so we don't delete unscored snapshots)
  try { await pruneOldSnapshots(env); }
  catch (err) { console.error("[cron] pruneOldSnapshots failed:", err instanceof Error ? err.message : err); }

  try { await assignSyncTiers(env); }
  catch (err) { console.error("[cron] assignSyncTiers failed:", err instanceof Error ? err.message : err); }

  try { await reEnqueueStaleTraders(env); }
  catch (err) { console.error("[cron] reEnqueueStaleTraders failed:", err instanceof Error ? err.message : err); }

  try { await rebuildCaches(env); }
  catch (err) { console.error("[cron] rebuildCaches failed:", err instanceof Error ? err.message : err); }

  console.log("[cron] Cycle complete");
}

/**
 * Purge accounts that have been failing for 7+ days.
 *
 * When a trader gets a "bad signal" (401, reset account, etc.), they're marked
 * inactive with first_failure_at set. If they recover (successful sync), the
 * failure state is cleared. If they don't recover within 7 days, we permanently
 * delete the account and all associated data.
 *
 * The DELETE CASCADE removes:
 *   - oauth_tokens (foreign key)
 *   - performance_snapshots (foreign key)
 *   - equity_history (foreign key)
 *   - trades (foreign key)
 */
async function purgeDeadAccounts(env: Env): Promise<void> {
  const cutoff = dbTimeAgo(7 * 86400);

  // First, log which accounts we're about to purge (for audit trail)
  const toPurge = await env.DB.prepare(`
    SELECT id, username, first_failure_at, last_failure_reason
    FROM traders
    WHERE first_failure_at IS NOT NULL
      AND first_failure_at < ?1
  `).bind(cutoff).all<{ id: string; username: string; first_failure_at: string; last_failure_reason: string | null }>();

  if (toPurge.results.length === 0) {
    return;
  }

  for (const row of toPurge.results) {
    console.log(`[cron] Purging dead account: ${row.username} (id=${row.id}, failed=${row.first_failure_at}, reason=${row.last_failure_reason})`);
  }

  // DELETE CASCADE removes all associated data
  const result = await env.DB.prepare(`
    DELETE FROM traders
    WHERE first_failure_at IS NOT NULL
      AND first_failure_at < ?1
  `).bind(cutoff).run();

  console.log(`[cron] Purged ${result.meta.changes} dead accounts`);
}

/**
 * Prune old performance_snapshots, keeping only the latest per trader.
 *
 * Historical snapshots are never queried - all leaderboard, profile, and scoring
 * queries use ROW_NUMBER() to get the latest snapshot per trader. Keeping old
 * snapshots wastes storage without providing value.
 *
 * This runs AFTER composite scores are computed, ensuring the latest snapshot
 * has its score calculated before we delete older ones.
 */
async function pruneOldSnapshots(env: Env): Promise<void> {
  // Delete all snapshots except the most recent per trader.
  // Uses a CTE with ROW_NUMBER to identify the latest snapshot per trader,
  // then deletes everything else.
  const result = await env.DB.prepare(`
    WITH latest AS (
      SELECT id
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY trader_id ORDER BY snapshot_date DESC) AS rn
        FROM performance_snapshots
      )
      WHERE rn = 1
    )
    DELETE FROM performance_snapshots
    WHERE id NOT IN (SELECT id FROM latest)
  `).run();

  if (result.meta.changes > 0) {
    console.log(`[cron] Pruned ${result.meta.changes} old snapshots`);
  }
}

/**
 * Compute composite scores entirely in SQL (no JS memory / D1 row limits).
 *
 * The composite score is a single 0-100 number that balances four dimensions
 * of trading performance. It's the primary ranking metric for the leaderboard.
 *
 * Weights:
 *   ROI %             (40%) — Raw return on investment. Rewards profitable agents.
 *   Sharpe Ratio      (30%) — Risk-adjusted return. Penalizes reckless gambling
 *                              even if ROI is high — wild volatility tanks Sharpe.
 *   Win Rate          (15%) — Consistency. % of trading days that were profitable.
 *   Inverse Drawdown  (15%) — Capital preservation. (100% - max_drawdown_pct).
 *                              Lower drawdown = higher score. Rewards agents that
 *                              don't blow up their account chasing gains.
 *
 * Normalization: Min-max scaling across the entire trader cohort.
 *   normalized = (value - min) / (max - min), clamped to [0, 1]
 *   This ensures each component contributes proportionally regardless of
 *   absolute scale (e.g., Sharpe ~0-3 vs ROI ~-50% to +200%).
 *
 * Final score: weighted sum * 100, rounded to 1 decimal.
 *   score = (0.4*norm_roi + 0.3*norm_sharpe + 0.15*norm_wr + 0.15*norm_imdd) * 100
 *
 * Edge cases:
 *   - If all traders have the same value for a metric (min = max),
 *     that component contributes 0 to avoid division by zero.
 *   - Traders without Sharpe or Win Rate (too few trading days) get a partial
 *     score using only ROI (72.7%) and inverse drawdown (27.3%). This keeps
 *     the 40:15 ratio between these two components while ensuring traders
 *     with positive ROI rank above those with zero ROI.
 *
 * Implementation: 2 D1 calls regardless of trader count.
 *   Step 1: Aggregate min/max ranges across all traders' latest snapshots.
 *   Step 2: Single UPDATE FROM applies the weighted formula to every snapshot.
 */
export async function computeAndStoreCompositeScores(env: Env): Promise<void> {
  // Use window function instead of self-join to find latest snapshot per trader.
  // This is more efficient: single table scan + sort vs GROUP BY + JOIN.
  const ranges = await env.DB.prepare(`
    WITH ranked AS (
      SELECT
        total_pnl_pct, sharpe_ratio, win_rate, max_drawdown_pct,
        ROW_NUMBER() OVER (PARTITION BY trader_id ORDER BY snapshot_date DESC) AS rn
      FROM performance_snapshots
    )
    SELECT
      MIN(total_pnl_pct)             AS roi_min,
      MAX(total_pnl_pct)             AS roi_max,
      MIN(sharpe_ratio)              AS sharpe_min,
      MAX(sharpe_ratio)              AS sharpe_max,
      MIN(win_rate)                  AS wr_min,
      MAX(win_rate)                  AS wr_max,
      MIN(100.0 - max_drawdown_pct)  AS imdd_min,
      MAX(100.0 - max_drawdown_pct)  AS imdd_max
    FROM ranked
    WHERE rn = 1
  `).first<ScoreRangesRow>();

  // Validate we have at least one snapshot with ROI data
  if (!ranges || ranges.roi_min === null || ranges.roi_max === null) {
    console.log("[cron] No snapshots with ROI data, skipping composite score computation");
    return;
  }

  // Extract ranges with safe defaults for optional metrics.
  // ROI and inverse max drawdown are always present (required fields in snapshot).
  // Sharpe and win_rate may be null if insufficient trading history.
  const roiMin  = ranges.roi_min;
  const roiMax  = ranges.roi_max;
  const shMin   = ranges.sharpe_min ?? 0;
  const shMax   = ranges.sharpe_max ?? 0;
  const wrMin   = ranges.wr_min ?? 0;
  const wrMax   = ranges.wr_max ?? 0;
  const imddMin = ranges.imdd_min ?? 100;  // 100% = 0% drawdown (safest)
  const imddMax = ranges.imdd_max ?? 100;

  // Use window function to identify latest snapshots, then update only those rows.
  // SQLite's UPDATE FROM allows us to join against the CTE to target specific rows.
  await env.DB.prepare(`
    WITH ranked AS (
      SELECT trader_id, snapshot_date,
        ROW_NUMBER() OVER (PARTITION BY trader_id ORDER BY snapshot_date DESC) AS rn
      FROM performance_snapshots
    )
    UPDATE performance_snapshots
    SET composite_score = ROUND((
      -- ROI component (40% weight, or 72.7% if sharpe/wr missing)
      CASE WHEN ?1 = ?2 THEN 0.0
           ELSE MAX(0.0, MIN(1.0, (total_pnl_pct - ?1) / (?2 - ?1)))
      END * CASE WHEN sharpe_ratio IS NULL OR win_rate IS NULL THEN 0.727 ELSE 0.4 END +
      -- Sharpe component (30% weight, or 0% if missing)
      CASE WHEN sharpe_ratio IS NULL OR ?3 = ?4 THEN 0.0
           ELSE MAX(0.0, MIN(1.0, (sharpe_ratio - ?3) / (?4 - ?3))) * 0.3
      END +
      -- Win rate component (15% weight, or 0% if missing)
      CASE WHEN win_rate IS NULL OR ?5 = ?6 THEN 0.0
           ELSE MAX(0.0, MIN(1.0, (win_rate - ?5) / (?6 - ?5))) * 0.15
      END +
      -- Inverse max drawdown component (15% weight, or 27.3% if sharpe/wr missing)
      CASE WHEN ?7 = ?8 THEN 0.0
           ELSE MAX(0.0, MIN(1.0, ((100.0 - max_drawdown_pct) - ?7) / (?8 - ?7)))
      END * CASE WHEN sharpe_ratio IS NULL OR win_rate IS NULL THEN 0.273 ELSE 0.15 END
    ) * 100.0, 1)
    FROM ranked
    WHERE performance_snapshots.trader_id = ranked.trader_id
      AND performance_snapshots.snapshot_date = ranked.snapshot_date
      AND ranked.rn = 1
  `).bind(roiMin, roiMax, shMin, shMax, wrMin, wrMax, imddMin, imddMax).run();
}

/**
 * Assign sync tiers entirely in SQL using ROW_NUMBER() + UPDATE FROM.
 *
 * Tiers mirror leaderboard position (composite_score DESC with the same
 * tiebreaker cascade used by the leaderboard query):
 *   Score → P&L$ → ROI% → Sharpe → Win Rate → MDD(ASC) → Trades → id
 *
 * Tier 1: Top 100       (synced every 5 min)
 * Tier 2: Rank 101-500  (synced every 30 min)
 * Tier 3: Rank 501-2000 (synced every 6 hours)
 * Tier 4: Rank 2001-10000 (synced every 12 hours)
 * Tier 5: Rank 10001+   (synced every 24 hours)
 *
 * Total: 1 D1 call regardless of trader count.
 */
async function assignSyncTiers(env: Env): Promise<void> {
  // Rank uses the exact same tiebreaker cascade as the leaderboard query
  // (buildTiebreakers in api.ts) so tier boundaries match what users see.
  const result = await env.DB.prepare(`
    WITH snapshot_ranked AS (
      SELECT trader_id, composite_score, total_pnl, total_pnl_pct,
        sharpe_ratio, win_rate, max_drawdown_pct, num_trades,
        ROW_NUMBER() OVER (PARTITION BY trader_id ORDER BY snapshot_date DESC) AS rn
      FROM performance_snapshots
    ),
    latest_scores AS (
      SELECT trader_id, composite_score, total_pnl, total_pnl_pct,
        sharpe_ratio, win_rate, max_drawdown_pct, num_trades
      FROM snapshot_ranked WHERE rn = 1
    ),
    ranked AS (
      SELECT t.id,
        ROW_NUMBER() OVER (
          ORDER BY
            COALESCE(ls.composite_score, -999999) DESC,
            COALESCE(ls.total_pnl, -999999) DESC,
            COALESCE(ls.total_pnl_pct, -999999) DESC,
            COALESCE(ls.sharpe_ratio, -999999) DESC,
            COALESCE(ls.win_rate, -999999) DESC,
            COALESCE(ls.max_drawdown_pct, 999999999) ASC,
            COALESCE(ls.num_trades, -999999) DESC,
            t.id ASC
        ) AS rk
      FROM traders t
      INNER JOIN oauth_tokens ot ON ot.trader_id = t.id
      LEFT JOIN latest_scores ls ON ls.trader_id = t.id
      WHERE t.is_active = 1
    )
    UPDATE traders SET sync_tier = CASE
      WHEN ranked.rk <= 100 THEN 1
      WHEN ranked.rk <= 500 THEN 2
      WHEN ranked.rk <= 2000 THEN 3
      WHEN ranked.rk <= 10000 THEN 4
      ELSE 5
    END
    FROM ranked
    WHERE traders.id = ranked.id
  `).run();

  console.log(`[cron] Assigned tiers to ${result.meta.changes} traders`);
}

/**
 * Safety net: re-enqueue active traders whose last sync is older than their
 * tier-appropriate staleness threshold.
 *
 * Tier-aware thresholds:
 *   Tier 1 (5min sync):   stale after 30 min
 *   Tier 2 (30min sync):  stale after 2 hours
 *   Tier 3 (6hr sync):    stale after 24 hours
 *   Tier 4 (12hr sync):   stale after 48 hours
 *   Tier 5 (24hr sync):   stale after 72 hours
 *
 * Ordered by tier ASC so high-priority traders recover first when the limit
 * is hit. Limit raised to 500 to recover faster from mass failures.
 */
async function reEnqueueStaleTraders(env: Env): Promise<void> {
  // Compute per-tier cutoff timestamps in ISO 8601 for direct string comparison.
  const cutoff1 = dbTimeAgo(tierStaleThresholdSeconds(1));
  const cutoff2 = dbTimeAgo(tierStaleThresholdSeconds(2));
  const cutoff3 = dbTimeAgo(tierStaleThresholdSeconds(3));
  const cutoff4 = dbTimeAgo(tierStaleThresholdSeconds(4));
  const cutoff5 = dbTimeAgo(tierStaleThresholdSeconds(5));

  const stale = await env.DB.prepare(`
    SELECT t.id, t.sync_tier
    FROM traders t
    INNER JOIN oauth_tokens ot ON ot.trader_id = t.id
    WHERE t.is_active = 1
      AND (
        t.last_synced_at IS NULL
        OR (t.sync_tier = 1 AND t.last_synced_at < ?1)
        OR (t.sync_tier = 2 AND t.last_synced_at < ?2)
        OR (t.sync_tier = 3 AND t.last_synced_at < ?3)
        OR (t.sync_tier = 4 AND t.last_synced_at < ?4)
        OR (t.sync_tier = 5 AND t.last_synced_at < ?5)
      )
    ORDER BY t.sync_tier ASC
    LIMIT 500
  `).bind(cutoff1, cutoff2, cutoff3, cutoff4, cutoff5)
    .all<StaleTraderRow>();

  if (stale.results.length === 0) return;

  // Log breakdown by tier for observability
  const byTier = new Map<number, number>();
  for (const row of stale.results) {
    byTier.set(row.sync_tier, (byTier.get(row.sync_tier) ?? 0) + 1);
  }

  for (const row of stale.results) {
    const tier = row.sync_tier as SyncTier;
    await env.SYNC_QUEUE.send(
      { traderId: row.id } satisfies SyncMessage,
      { delaySeconds: tierDelaySeconds(tier) }
    );
  }

  const tierBreakdown = [...byTier.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, n]) => `T${t}=${n}`)
    .join(", ");
  console.log(`[cron] Re-enqueued ${stale.results.length} stale traders (${tierBreakdown})`);
}

async function rebuildCaches(env: Env): Promise<void> {
  // No manual cache invalidation needed — all KV entries use TTLs (15 min for
  // leaderboard, 5 min for trader data). Stale entries expire naturally.
  // Pre-warming below overwrites the default view key with fresh data.

  // Record the last successful cron refresh time for UI timestamps.
  await env.KV.put("leaderboard:last_updated", dbNow());

  // Pre-cache the default leaderboard view
  const defaultData = await queryLeaderboard(env, {
    sort: "composite_score", sortDir: "desc",
    minTrades: 0, limit: 100, offset: 0,
  });
  const defaultKey = leaderboardCacheKey("composite_score", "desc", 0);
  await setCachedLeaderboard(env, defaultKey, defaultData);

  // Pre-cache stats
  const stats = await queryStats(env);
  await setCachedStats(env, stats);
}
