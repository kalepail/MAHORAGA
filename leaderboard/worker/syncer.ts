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
  AlpacaError,
} from "./alpaca";
import { calcSharpeRatio, calcMaxDrawdown, calcWinRate } from "./metrics";

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

export class SyncerDO extends DurableObject<Env> {
  /**
   * Called by the queue consumer or manual sync endpoint.
   * Fetches all data from Alpaca and writes results to D1.
   */
  async sync(traderId: string, accessToken: string): Promise<SyncResult> {
    try {
      // Parallel fetch: account + positions + portfolio history + deposits
      // Orders fetched separately since we need both count and recent list
      const [account, positions, history, totalDeposits, filledCount] =
        await Promise.all([
          fetchAccount(accessToken),
          fetchPositions(accessToken),
          fetchPortfolioHistory(accessToken, { period: "all", timeframe: "1D" }),
          fetchTotalDeposits(accessToken),
          fetchTotalFilledOrderCount(accessToken),
        ]);

      // Fetch recent orders for trade display (separate, smaller call)
      const recentOrders = await fetchClosedOrders(accessToken, 200);

      // ---------------------------------------------------------------
      // Compute metrics from portfolio history
      // ---------------------------------------------------------------

      const equity = account.equity;
      const cash = account.cash;
      const dayPnl = equity - account.last_equity;
      const effectiveDeposits = totalDeposits > 0 ? totalDeposits : history.base_value;
      const totalPnl = equity - effectiveDeposits;
      const totalPnlPct =
        effectiveDeposits > 0 ? ((equity - effectiveDeposits) / effectiveDeposits) * 100 : 0;

      const unrealizedPnl = positions.reduce((s, p) => s + p.unrealized_pl, 0);
      const realizedPnl = totalPnl - unrealizedPnl;

      // Sharpe ratio from daily equity
      const dailyEquity = history.equity.filter((e) => e > 0);
      const sharpe = calcSharpeRatio(dailyEquity);

      // Max drawdown from daily equity
      const maxDrawdownPct = calcMaxDrawdown(dailyEquity);

      // Win rate from daily P&L
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

      const statements: D1PreparedStatement[] = [];

      // 1. Performance snapshot
      statements.push(
        this.env.DB.prepare(
          `INSERT OR REPLACE INTO performance_snapshots
           (id, trader_id, snapshot_date, equity, cash, total_deposits,
            total_pnl, total_pnl_pct, unrealized_pnl, realized_pnl,
            day_pnl, num_trades, num_winning_trades, win_rate,
            max_drawdown_pct, sharpe_ratio, open_positions, composite_score)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, NULL)`
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
          positions.length
        )
      );

      // 2. Derive asset_class from positions + recent orders
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

      // Update trader metadata including last_trade_at
      statements.push(
        this.env.DB.prepare(
          `UPDATE traders SET last_synced_at = datetime('now'), asset_class = ?2, last_trade_at = ?3
           WHERE id = ?1`
        ).bind(traderId, derivedAssetClass, lastTradeAt)
      );

      // 3. Replace equity history (delete old, insert new)
      // DELETE is in this batch so it's atomic with the snapshot write
      statements.push(
        this.env.DB.prepare(
          `DELETE FROM equity_history WHERE trader_id = ?1`
        ).bind(traderId)
      );

      await this.env.DB.batch(statements);

      // 4. Insert equity history points in batches
      const equityPoints: D1PreparedStatement[] = [];
      const maxPoints = Math.min(history.timestamp.length, 365);
      const startIdx = Math.max(0, history.timestamp.length - maxPoints);

      for (let i = startIdx; i < history.timestamp.length; i++) {
        equityPoints.push(
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

      for (let i = 0; i < equityPoints.length; i += 80) {
        await this.env.DB.batch(equityPoints.slice(i, i + 80));
      }

      // 5. Upsert recent trades
      await this.env.DB.prepare(
        `DELETE FROM trades WHERE trader_id = ?1`
      ).bind(traderId).run();

      const tradeStatements: D1PreparedStatement[] = [];
      for (const order of recentOrders.slice(0, 200)) {
        if (!order.filled_at || !order.filled_avg_price) continue;

        let assetClass = "stocks";
        if (order.asset_class === "crypto") assetClass = "crypto";

        tradeStatements.push(
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

      for (let i = 0; i < tradeStatements.length; i += 80) {
        await this.env.DB.batch(tradeStatements.slice(i, i + 80));
      }

      // 6. Update oauth_tokens last_used_at
      await this.env.DB.prepare(
        `UPDATE oauth_tokens SET last_used_at = datetime('now') WHERE trader_id = ?1`
      ).bind(traderId).run();

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

      console.error(`Sync failed for trader ${traderId}:`, msg);

      return {
        success: false,
        traderId,
        error: msg,
        alpacaStatus: isAlpacaError ? err.status : undefined,
      };
    }
  }
}
