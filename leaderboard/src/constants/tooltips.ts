/**
 * Centralized tooltip content for metrics across the application.
 * Single source of truth for both Leaderboard and TraderProfile pages.
 */

export const METRIC_TOOLTIPS = {
  // Shared metrics (leaderboard columns + profile cards)
  score:
    "Composite score (0-100) combining ROI (40%), Sharpe ratio (30%), win rate (15%), and inverse drawdown (15%).",
  roi:
    "Return on investment as a percentage of starting capital.",
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

  // Leaderboard stats bar
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

  // Badge tooltips
  agentBadge:
    "STOCKS = trades equities only. CRYPTO = trades crypto only. BOTH = trades stocks and crypto.",
} as const;
