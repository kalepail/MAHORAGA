/**
 * SyncerDO — Durable Object that handles per-trader Alpaca data sync.
 *
 * One instance per trader. Called by the queue consumer or manual sync endpoint.
 * Each DO independently fetches from Alpaca, computes metrics, and writes
 * results to D1. This gives each trader its own 15-minute duration budget
 * and isolates failures.
 */

import { DurableObject } from "cloudflare:workers";
import {
  fetchAccount,
  fetchPositions,
  fetchPortfolioHistory,
  fetchTotalDeposits,
  fetchClosedOrders,
  fetchTotalFilledOrderCount,
  fetchFilledOrderCountSince,
  AlpacaError,
} from "./alpaca";
import { calcSharpeRatio, calcMaxDrawdown, calcWinRate } from "./metrics";

// D1 allows up to 100 statements per batch. We use 80 as a conservative
// limit. The first batch in a delete+reinsert sequence reserves 1 slot
// for the DELETE, leaving (D1_BATCH_SIZE - 1) slots for INSERTs.
const D1_BATCH_SIZE = 80;

export interface SyncResult {
  success: boolean;
  traderId: string;
  equity?: number;
  totalPnlPct?: number;
  sharpe?: number | null;
  winRate?: number | null;
  maxDrawdownPct?: number;
  numTrades?: number;
  error?: string;
  /** HTTP status from Alpaca if the error was an API failure. 401 = revoked token. */
  alpacaStatus?: number;
}

/** Row type for stored incremental counting data. */
interface TraderIncrementalRow {
  lifetime_trade_count: number | null;
  last_count_order_submitted_at: string | null;
  last_count_order_id: string | null;
}

export class SyncerDO extends DurableObject<Env> {
  /**
   * Called by the queue consumer or manual sync endpoint.
   * Fetches all data from Alpaca and writes results to D1.
   */
  async sync(traderId: string, accessToken: string): Promise<SyncResult> {
    try {
      // ---------------------------------------------------------------
      // Fetch stored incremental counting data
      // ---------------------------------------------------------------
      const storedCounts = await this.env.DB.prepare(
        `SELECT lifetime_trade_count, last_count_order_submitted_at, last_count_order_id FROM traders WHERE id = ?1`
      ).bind(traderId).first<TraderIncrementalRow>();

      // ---------------------------------------------------------------
      // Parallel fetch: account + positions + portfolio history + deposits
      // Trade count is handled separately for incremental optimization
      // ---------------------------------------------------------------
      const [account, positions, history, totalDeposits, recentOrders] =
        await Promise.all([
          fetchAccount(accessToken),
          fetchPositions(accessToken),
          fetchPortfolioHistory(accessToken, { period: "all", timeframe: "1D" }),
          fetchTotalDeposits(accessToken),
          fetchClosedOrders(accessToken, 100),
        ]);

      // ---------------------------------------------------------------
      // Trade Counting — Incremental when possible
      // ---------------------------------------------------------------
      // Instead of paginating through ALL orders every sync (O(n) API calls),
      // we store a running total and only count new orders since last sync.
      //
      // Full count is done ONLY when:
      //   - First sync (no stored count)
      //   - After migration (stored count is NULL)
      //
      // If incremental count hits page limit (5000+ new orders), we accept
      // the partial count and continue from there on the next sync. This
      // ensures bounded API calls even for hyperactive traders.
      //
      // Deduping: Uses exact checkpoint timestamp + anchor order ID.
      // Alpaca's `after` is inclusive so the anchor appears in results and
      // is skipped by ID. If the anchor is missing, falls back to full recount.
      // ---------------------------------------------------------------

      let filledCount: number;
      let newLastCountOrderSubmittedAt: string | null;
      let newLastCountOrderId: string | null;

      // Check if we have stored incremental counting data
      const storedLifetimeCount = storedCounts?.lifetime_trade_count;
      const storedLastOrderSubmittedAt = storedCounts?.last_count_order_submitted_at;
      const storedLastOrderId = storedCounts?.last_count_order_id;

      if (storedLifetimeCount !== null && storedLifetimeCount !== undefined &&
          storedLastOrderSubmittedAt !== null && storedLastOrderSubmittedAt !== undefined) {
        // Incremental count: use exact checkpoint timestamp + anchor ID.
        // Alpaca's `after` is inclusive, so the anchor order appears in results.
        // We skip it by ID and count only genuinely new orders after it.
        // If anchor isn't found, we fall back to a full recount.
        const incrementalResult = await fetchFilledOrderCountSince(
          accessToken,
          storedLastOrderSubmittedAt,
          storedLastOrderId ?? "",
          10 // Max 10 pages = 5000 new orders
        );

        if (incrementalResult.anchorNotFound) {
          // Anchor order vanished from Alpaca (purged, or data corruption).
          // Fall back to a full recount to self-heal rather than freezing.
          console.log(`[syncer] Trader ${traderId}: anchor order not found, falling back to full recount`);
          const fullResult = await fetchTotalFilledOrderCount(accessToken);
          filledCount = fullResult.count;
          newLastCountOrderSubmittedAt = fullResult.newestOrderSubmittedAt;
          newLastCountOrderId = fullResult.newestOrderId;
        } else {
          // Add the new count to our running total
          filledCount = storedLifetimeCount + incrementalResult.newCount;

          // Update checkpoint to where we stopped (or keep old if no new orders)
          // Because we paginate ASC (oldest→newest), this is always safe:
          // - If we finished: checkpoint is the newest order, we're caught up
          // - If we hit limit: checkpoint is where we stopped, next sync continues from there
          newLastCountOrderSubmittedAt = incrementalResult.lastProcessedOrderSubmittedAt ??
                                         storedLastOrderSubmittedAt;
          newLastCountOrderId = incrementalResult.lastProcessedOrderId ??
                                storedLastOrderId ?? null;

          if (incrementalResult.hitPageLimit) {
            console.log(`[syncer] Trader ${traderId}: incremental count hit page limit (counted ${incrementalResult.newCount} new), will continue from checkpoint next sync`);
          }
        }
      } else {
        // No stored count — do full count
        const fullResult = await fetchTotalFilledOrderCount(accessToken);
        filledCount = fullResult.count;
        newLastCountOrderSubmittedAt = fullResult.newestOrderSubmittedAt;
        newLastCountOrderId = fullResult.newestOrderId;
      }

      // ---------------------------------------------------------------
      // P&L Calculation — Starting Capital Baseline
      // ---------------------------------------------------------------
      //
      // Alpaca paper accounts can be seeded with any amount ($1 to $1M).
      // The initial seed is NOT a "deposit" in Alpaca's activity system —
      // it doesn't generate CSD (Cash Deposit) activity records. This
      // means fetchTotalDeposits() returns $0 for paper accounts that
      // haven't had explicit transfers.
      //
      // To correctly calculate P&L (profit above/below starting capital),
      // we need the "cost basis" — the total capital put into the account.
      // We determine this with a fallback chain:
      //
      //   1. CSD deposits > 0 → Use sum of CSD activities as cost basis.
      //      This handles the case where the initial seed IS recorded
      //      as a CSD, or where a Broker API sandbox account has explicit
      //      transfers. For standard paper accounts, CSD total is $0.
      //
      //   2. CSD deposits = 0 → Use portfolio history `base_value`.
      //      Alpaca's GET /v2/account/portfolio/history returns `base_value`
      //      which is the account equity at the beginning of the requested
      //      period. With period=all, this is the first day's equity —
      //      whatever the account was originally seeded with. This is the
      //      correct cost basis because it represents the initial capital
      //      before any trading occurred.
      //
      // Example: Account seeded with $50k, trades up to $75k
      //   effectiveDeposits = $50,000 (from base_value)
      //   totalPnl = $75,000 - $50,000 = $25,000 ← correct profit
      //   totalPnlPct = ($25,000 / $50,000) * 100 = 50% ← correct ROI
      //
      // The starting balance is NOT counted as profit. Only gains or
      // losses relative to that baseline are reflected in P&L metrics.
      // This works regardless of whether the account was seeded with
      // $1k or $1M — the math adapts to the actual starting capital.
      //
      // Note: Users cannot add funds to an existing paper account via
      // Alpaca's Trading API. To "reset" they must delete and recreate
      // the account (which generates new API keys and a new account ID).
      // ---------------------------------------------------------------

      const equity = account.equity;
      const cash = account.cash;

      // ---------------------------------------------------------------
      // Detect Reset/Deleted Accounts
      // ---------------------------------------------------------------
      // If equity is 0 with no positions and no trades, the account was likely
      // reset or deleted in Alpaca. This is NOT a genuine -100% loss through
      // trading. Return an error so the user can re-connect with their new account.
      if (equity === 0 && positions.length === 0 && filledCount === 0) {
        return {
          success: false,
          traderId,
          error: "Account appears to be reset or deleted (zero equity, no positions, no trades)",
          alpacaStatus: 200, // Not a token issue, just empty account
        };
      }

      // Day P&L: change in equity since previous market close.
      // Alpaca updates `last_equity` at end of each trading day.
      const dayPnl = equity - account.last_equity;

      // Determine the cost basis (total capital put into the account).
      // See detailed explanation above for why this fallback chain works.
      const effectiveDeposits = totalDeposits > 0 ? totalDeposits : history.base_value;

      // Total P&L: current equity minus cost basis. This is the net profit
      // (or loss) including both realized gains from closed trades and
      // unrealized gains from open positions.
      const totalPnl = equity - effectiveDeposits;

      // Total P&L %: return on investment as a percentage of cost basis.
      const totalPnlPct =
        effectiveDeposits > 0 ? ((equity - effectiveDeposits) / effectiveDeposits) * 100 : 0;

      // Split total P&L into unrealized (open positions) and realized (closed trades).
      // Unrealized P&L comes directly from Alpaca's position data.
      // Realized P&L is derived: total P&L minus what's still unrealized.
      const unrealizedPnl = positions.reduce((s, p) => s + p.unrealized_pl, 0);
      const realizedPnl = totalPnl - unrealizedPnl;

      // ---------------------------------------------------------------
      // Advanced Metrics (from daily equity curve)
      // ---------------------------------------------------------------

      // Filter out zero-equity days (account not yet funded or data gaps)
      const dailyEquity = history.equity.filter((e) => e > 0);

      // Annualized Sharpe ratio: risk-adjusted return metric.
      // Higher = better returns per unit of risk taken.
      // Requires 5+ days of equity data. See metrics.ts for formula.
      const sharpe = calcSharpeRatio(dailyEquity);

      // Maximum drawdown: worst peak-to-trough decline as a percentage.
      // Lower = better capital preservation. A 10% max drawdown means
      // the account never fell more than 10% from its highest point.
      const maxDrawdownPct = calcMaxDrawdown(dailyEquity);

      // Win rate: percentage of trading days with positive P&L.
      // Based on days, not individual trades, to avoid rewarding
      // high-frequency churn. See metrics.ts for details.
      const winResult = calcWinRate(history.profit_loss);
      const winRate = winResult?.rate ?? null;
      const winningDays = winResult?.winning ?? 0;

      const today = new Date().toISOString().split("T")[0];
      const snapshotId = crypto.randomUUID();

      // Determine last_trade_at from the most recent filled order
      const lastTradeAt = recentOrders.length > 0 ? recentOrders[0].filled_at : null;

      // ---------------------------------------------------------------
      // Write to D1 in a single batch (transactional)
      // ---------------------------------------------------------------

      // Preserve existing composite_score (computed by cron) before overwriting.
      // We fetch it first because INSERT OR REPLACE deletes the old row, and
      // SQLite behavior with self-referencing subqueries in REPLACE is undefined.
      const existingScore = await this.env.DB.prepare(
        `SELECT composite_score FROM performance_snapshots
         WHERE trader_id = ?1 AND snapshot_date = ?2`
      ).bind(traderId, today).first<{ composite_score: number | null }>();

      const statements: D1PreparedStatement[] = [];

      // 1. Performance snapshot — one row per trader per day.
      //    INSERT OR REPLACE ensures only the latest sync for today is kept.
      //    composite_score is preserved if it exists, otherwise NULL (computed by cron).
      //
      //    Column mapping:
      //      total_deposits    = effectiveDeposits (starting capital, not just CSD deposits)
      //      num_trades        = filledCount (total filled orders, ALL-TIME via pagination)
      //      num_winning_trades = winningDays (profitable DAYS, not individual trades)
      //      win_rate          = % of active trading days with positive P&L
      statements.push(
        this.env.DB.prepare(
          `INSERT OR REPLACE INTO performance_snapshots
           (id, trader_id, snapshot_date, equity, cash, total_deposits,
            total_pnl, total_pnl_pct, unrealized_pnl, realized_pnl,
            day_pnl, num_trades, num_winning_trades, win_rate,
            max_drawdown_pct, sharpe_ratio, open_positions, composite_score)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`
        ).bind(
          snapshotId,
          traderId,
          today,
          equity,
          cash,
          effectiveDeposits,
          totalPnl,
          totalPnlPct,
          unrealizedPnl,
          realizedPnl,
          dayPnl,
          filledCount,
          winningDays,
          winRate,
          maxDrawdownPct,
          sharpe,
          positions.length,
          existingScore?.composite_score ?? null
        )
      );

      // 2. Derive asset_class from positions + recent orders.
      //    This is a sticky classification: once a trader has both stocks and
      //    crypto, they stay as "both" even if they later only trade one.
      //    Used for the asset class filter on the leaderboard (stocks/crypto/all).
      const hasCrypto =
        positions.some((p) => p.asset_class === "crypto") ||
        recentOrders.some((o) => o.asset_class === "crypto");
      const hasStocks =
        positions.some((p) => p.asset_class !== "crypto") ||
        recentOrders.some((o) => o.asset_class !== "crypto");
      const derivedAssetClass = hasCrypto && hasStocks
        ? "both"
        : hasCrypto
          ? "crypto"
          : "stocks";

      // Update trader metadata including last_trade_at and incremental counting fields
      statements.push(
        this.env.DB.prepare(
          `UPDATE traders SET
             last_synced_at = datetime('now'),
             asset_class = ?2,
             last_trade_at = ?3,
             lifetime_trade_count = ?4,
             last_count_order_submitted_at = ?5,
             last_count_order_id = ?6
           WHERE id = ?1`
        ).bind(traderId, derivedAssetClass, lastTradeAt, filledCount, newLastCountOrderSubmittedAt, newLastCountOrderId)
      );

      // Record last successful API usage timestamp
      statements.push(
        this.env.DB.prepare(
          `UPDATE oauth_tokens SET last_used_at = datetime('now') WHERE trader_id = ?1`
        ).bind(traderId)
      );

      await this.env.DB.batch(statements);

      // 3. Replace equity history with atomic delete + insert batches.
      //    Stores up to 90 daily data points from Alpaca's portfolio history.
      //    Used for sparklines on the leaderboard (last 30 points) and the
      //    equity curve chart on trader profiles (up to 90 days displayed).
      //
      //    Safety: Each batch includes DELETE (idempotent) + INSERTs so that
      //    if a batch fails mid-way, re-running from scratch is safe.
      const maxPoints = Math.min(history.timestamp.length, 90);
      const startIdx = Math.max(0, history.timestamp.length - maxPoints);

      const equityInserts: D1PreparedStatement[] = [];
      for (let i = startIdx; i < history.timestamp.length; i++) {
        equityInserts.push(
          this.env.DB.prepare(
            `INSERT INTO equity_history (id, trader_id, timestamp, equity, profit_loss, profit_loss_pct)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
          ).bind(
            crypto.randomUUID(),
            traderId,
            new Date(history.timestamp[i]).toISOString(),
            history.equity[i],
            history.profit_loss[i],
            history.profit_loss_pct[i]
          )
        );
      }

      // First batch: DELETE + first chunk of inserts (atomic)
      // Subsequent batches: just inserts (DELETE already done)
      const equityDeleteStmt = this.env.DB.prepare(
        `DELETE FROM equity_history WHERE trader_id = ?1`
      ).bind(traderId);

      if (equityInserts.length > 0) {
        const firstChunk = D1_BATCH_SIZE - 1; // reserve 1 slot for DELETE
        const firstBatch = [equityDeleteStmt, ...equityInserts.slice(0, firstChunk)];
        await this.env.DB.batch(firstBatch);
        for (let i = firstChunk; i < equityInserts.length; i += D1_BATCH_SIZE) {
          await this.env.DB.batch(equityInserts.slice(i, i + D1_BATCH_SIZE));
        }
      } else {
        // No history points — just delete old data
        await equityDeleteStmt.run();
      }

      // 4. Replace recent trades with atomic delete + insert batches.
      //    Stores the latest 100 filled orders for display on the trader
      //    profile page. This is NOT the total trade count — that comes from
      //    fetchTotalFilledOrderCount() which paginates through all orders.
      const tradeInserts: D1PreparedStatement[] = [];
      for (const order of recentOrders.slice(0, 100)) {
        if (!order.filled_at || !order.filled_avg_price) continue;

        const assetClass = order.asset_class === "crypto" ? "crypto" : "stocks";

        tradeInserts.push(
          this.env.DB.prepare(
            `INSERT OR IGNORE INTO trades (id, trader_id, symbol, side, qty, price, filled_at, asset_class)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
          ).bind(
            order.id,
            traderId,
            order.symbol,
            order.side,
            order.filled_qty,
            order.filled_avg_price,
            order.filled_at,
            assetClass
          )
        );
      }

      // First batch: DELETE + first chunk of inserts (atomic)
      const tradesDeleteStmt = this.env.DB.prepare(
        `DELETE FROM trades WHERE trader_id = ?1`
      ).bind(traderId);

      if (tradeInserts.length > 0) {
        const firstChunk = D1_BATCH_SIZE - 1; // reserve 1 slot for DELETE
        const firstBatch = [tradesDeleteStmt, ...tradeInserts.slice(0, firstChunk)];
        await this.env.DB.batch(firstBatch);
        for (let i = firstChunk; i < tradeInserts.length; i += D1_BATCH_SIZE) {
          await this.env.DB.batch(tradeInserts.slice(i, i + D1_BATCH_SIZE));
        }
      } else {
        // No trades — just delete old data
        await tradesDeleteStmt.run();
      }

      return {
        success: true,
        traderId,
        equity,
        totalPnlPct,
        sharpe,
        winRate,
        maxDrawdownPct,
        numTrades: filledCount,
      };
    } catch (err) {
      const isAlpacaError = err instanceof AlpacaError;
      const msg = isAlpacaError
        ? `${err.endpoint}: ${err.status}`
        : (err instanceof Error ? err.message : "Unknown error");

      console.error(`[syncer] Sync failed for trader ${traderId}:`, msg,
        isAlpacaError ? err.sanitizedBody : "");

      return {
        success: false,
        traderId,
        error: msg,
        alpacaStatus: isAlpacaError ? err.status : undefined,
      };
    }
  }
}
