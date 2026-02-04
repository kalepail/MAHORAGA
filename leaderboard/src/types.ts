export interface TraderRow {
  username: string;
  github_repo: string;
  asset_class: "stocks" | "crypto" | "both";
  joined_at: string;
  equity: number | null;
  total_pnl: number | null;
  total_pnl_pct: number | null;
  total_deposits: number | null;
  sharpe_ratio: number | null;
  win_rate: number | null;
  max_drawdown_pct: number | null;
  num_trades: number | null;
  composite_score: number | null;
  open_positions: number | null;
  snapshot_date: string | null;
  sparkline: number[];
  pending_sync?: boolean | number;
}

export interface LeaderboardResponse {
  traders: TraderRow[];
  meta: {
    limit: number;
    offset: number;
    sort: string;
  };
}

export interface LeaderboardStats {
  total_traders: number;
  total_trades: number;
  total_pnl: number;
  last_updated: string | null;
}

export interface TraderProfile {
  trader: {
    id: string;
    username: string;
    github_repo: string;
    asset_class: "stocks" | "crypto" | "both";
    joined_at: string;
    last_synced_at: string | null;
  };
  snapshot: {
    equity: number;
    cash: number;
    total_deposits: number;
    total_pnl: number;
    total_pnl_pct: number;
    unrealized_pnl: number;
    realized_pnl: number;
    day_pnl: number;
    num_trades: number;
    num_winning_trades: number;
    win_rate: number | null;
    max_drawdown_pct: number | null;
    sharpe_ratio: number | null;
    open_positions: number;
    composite_score: number | null;
    snapshot_date: string;
  } | null;
}

export interface Trade {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  filled_at: string;
  asset_class: string;
}

export interface EquityPoint {
  timestamp: string;
  equity: number;
  profit_loss: number;
  profit_loss_pct: number;
}

export type SortField =
  | "composite_score"
  | "total_pnl_pct"
  | "total_pnl"
  | "sharpe_ratio"
  | "win_rate"
  | "max_drawdown_pct"
  | "num_trades";
export type AssetFilter = "all" | "stocks" | "crypto" | "both";
