/**
 * Financial metric calculations for the leaderboard.
 *
 * All calculations use daily equity values from Alpaca's portfolio history
 * endpoint (GET /v2/account/portfolio/history?timeframe=1D).
 *
 * Excluded metrics and reasoning:
 * - Sortino ratio: requires separating downside deviation, marginal value
 *   over Sharpe for a paper trading leaderboard.
 * - Profit factor: requires pairing individual buy/sell trades, which is
 *   complex with partial fills and multiple entries/exits.
 * - Average trade duration: same pairing complexity as profit factor.
 */

/**
 * Annualized Sharpe ratio from daily equity values.
 *
 * Formula: (mean(daily_returns) - daily_rf) / stddev(daily_returns) * sqrt(252)
 *
 * Requires at least 5 days of data to produce a meaningful result.
 * Uses 5% annual risk-free rate (US T-bill approximate).
 */
export function calcSharpeRatio(
  dailyEquity: number[],
  riskFreeAnnual = 0.05
): number | null {
  if (dailyEquity.length < 5) return null;

  const returns: number[] = [];
  for (let i = 1; i < dailyEquity.length; i++) {
    if (dailyEquity[i - 1] <= 0) continue;
    returns.push((dailyEquity[i] - dailyEquity[i - 1]) / dailyEquity[i - 1]);
  }

  if (returns.length < 4) return null;

  const dailyRf = riskFreeAnnual / 252;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
    (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  return ((mean - dailyRf) / stdDev) * Math.sqrt(252);
}

/**
 * Maximum drawdown as a percentage (0 to 100).
 *
 * Measures the largest peak-to-trough decline in the equity curve.
 * Returns a positive number representing the percentage drop.
 */
export function calcMaxDrawdown(dailyEquity: number[]): number {
  if (dailyEquity.length < 2) return 0;

  let peak = dailyEquity[0];
  let maxDd = 0;

  for (const eq of dailyEquity) {
    if (eq > peak) peak = eq;
    if (peak > 0) {
      const dd = ((peak - eq) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }

  return maxDd;
}

/**
 * Win rate based on profitable trading days.
 *
 * A "winning day" is any day where the daily P&L > 0.
 * Days with exactly 0 P&L are excluded (weekends/holidays with no change).
 *
 * Returns { rate (0-100), winning, total } or null if insufficient data.
 */
export function calcWinRate(
  dailyPnl: number[]
): { rate: number; winning: number; total: number } | null {
  // Filter out zero-change days (market closed, no activity)
  const activeDays = dailyPnl.filter((pnl) => pnl !== 0);
  if (activeDays.length < 2) return null;

  const winning = activeDays.filter((pnl) => pnl > 0).length;
  return {
    rate: (winning / activeDays.length) * 100,
    winning,
    total: activeDays.length,
  };
}
