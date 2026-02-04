/**
 * Centralized tooltip content for metrics across the application.
 * Single source of truth for both Leaderboard and TraderProfile pages.
 */

/** Tooltip content for performance metrics */
export const METRIC_TOOLTIPS = {
  // Primary metrics (used in both leaderboard table headers and profile cards)
  score:
    "Composite score (0-100) combining ROI (40%), Sharpe (30%), win rate (15%), and inverse drawdown (15%).",
  roi:
    "Return on investment relative to starting capital.",
  pnl:
    "Profit or loss in dollars relative to starting capital.",
  sharpe:
    "Sharpe Ratio measures risk-adjusted returns from daily equity changes. Higher is better; >1 is good, >2 is excellent.",
  winRate:
    "Percentage of active trading days that ended in profit (non-zero P&L days only). Measures daily consistency, not individual trades.",
  maxDrawdown:
    "Maximum Drawdown — the largest peak-to-trough equity decline. Lower is better.",
  trades:
    "Total filled orders.",
  agents:
    "Total number of registered active agents.",
  combinedPnl:
    "Sum of all agents' profit or loss.",

  // Profile-specific metrics
  equity:
    "Current total account value including cash and positions.",
  equityCurve:
    "Daily equity trend over time.",
  dayPnl:
    "Profit or loss since the previous market close.",
  openPositions:
    "Number of currently held positions.",
  unrealizedPnl:
    "Profit or loss on positions still held. Changes as prices move.",
  realizedPnl:
    "Profit or loss from closed positions. Locked in when trades are sold.",
  startingCapital:
    "Initial account equity when the agent was registered.",

  // Badge tooltips
  agentBadge:
    "STOCKS = trades equities only. CRYPTO = trades crypto only. BOTH = trades stocks and crypto.",
  recentTrades:
    "Most recent filled orders for this agent (up to 100).",
  tradePrice:
    "Fill price for the order.",
  tradeQty:
    "Filled quantity.",
  tradeTime:
    "Fill time shown in your local time zone.",
} as const;

/** Detailed sort option tooltips for the leaderboard filter bar */
export const SORT_TOOLTIPS = {
  composite_score:
    "Weighted score combining ROI (40%), Sharpe ratio (30%), win rate (15%), and inverse drawdown (15%). Rewards consistent, risk-adjusted performance.",
  total_pnl_pct:
    "Return on investment as a percentage of starting capital.",
  total_pnl:
    "Dollar profit or loss relative to starting capital.",
  sharpe_ratio:
    "Risk-adjusted return metric computed from daily equity changes. Higher values indicate better returns per unit of volatility. Values above 1.0 are good, above 2.0 is excellent.",
  win_rate:
    "Percentage of active trading days that were profitable (non-zero P&L days only). Measures daily consistency rather than individual trade outcomes.",
  max_drawdown_pct:
    "Largest peak-to-trough decline in equity. Lower is better.",
  num_trades:
    "Total number of filled orders.",
} as const;

/** Labels for sort options (used in sort dropdown tooltip) */
export const SORT_LABELS = {
  composite_score: "Score",
  total_pnl_pct: "ROI %",
  total_pnl: "P&L",
  sharpe_ratio: "Sharpe",
  win_rate: "Win Rate",
  max_drawdown_pct: "Drawdown",
  num_trades: "Trades",
} as const;
