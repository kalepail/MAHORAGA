/**
 * Sync tier definitions for queue-based adaptive sync.
 *
 * Each trader is assigned a tier based purely on their leaderboard
 * position (composite_score DESC with the standard tiebreaker cascade).
 * The tier determines how frequently their data is synced from Alpaca.
 */

export type SyncTier = 1 | 2 | 3 | 4 | 5;

/** Delay in seconds between syncs for each tier. */
const TIER_DELAYS: Record<SyncTier, number> = {
  1: 300,      // 5 min   — Top 100
  2: 1800,     // 30 min  — Rank 101–500
  3: 21600,    // 6 hours — Rank 501–2000
  4: 43200,    // 12 hours — Rank 2001–10000
  5: 86400,    // 24 hours — Rank 10001+
};

export function tierDelaySeconds(tier: SyncTier): number {
  return TIER_DELAYS[tier];
}

/**
 * How long a trader can go without syncing before being considered stale.
 *
 * A "stale" trader is one whose queue message was likely lost — their
 * last_synced_at is far older than their tier's expected sync interval.
 * The cron safety net uses these thresholds to re-enqueue lost traders.
 *
 * Set to ~10x the tier delay for high-priority tiers (quick detection)
 * and ~4x for lower tiers (where longer gaps are normal).
 */
const STALE_THRESHOLDS: Record<SyncTier, number> = {
  1: 1800,     // 30 min   (6x tier delay)
  2: 7200,     // 2 hours  (4x tier delay)
  3: 86400,    // 24 hours (4x tier delay)
  4: 172800,   // 48 hours (4x tier delay)
  5: 259200,   // 72 hours (3x tier delay)
};

export function tierStaleThresholdSeconds(tier: SyncTier): number {
  return STALE_THRESHOLDS[tier];
}
