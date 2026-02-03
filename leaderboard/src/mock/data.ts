import type {
  TraderRow,
  TraderProfile,
  Trade,
  EquityPoint,
  LeaderboardStats,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed-based pseudo-random for deterministic data across reloads. */
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Generate a realistic equity curve starting from `initial` over `days`. */
function generateEquityCurve(
  initial: number,
  final: number,
  days: number,
  seed: number
): number[] {
  const rng = seededRandom(seed);
  const drift = (final - initial) / days;
  const volatility = initial * 0.008;
  const points: number[] = [initial];
  for (let i = 1; i <= days; i++) {
    const prev = points[i - 1];
    const noise = (rng() - 0.5) * 2 * volatility;
    points.push(Math.round((prev + drift + noise) * 100) / 100);
  }
  // Ensure the last point matches the desired final equity
  points[points.length - 1] = final;
  return points;
}

/** Generate ISO timestamp strings going back `days` from today. */
function generateTimestamps(days: number): string[] {
  const now = new Date();
  return Array.from({ length: days + 1 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - i));
    d.setHours(16, 0, 0, 0);
    return d.toISOString();
  });
}

// ---------------------------------------------------------------------------
// Agent Definitions
// ---------------------------------------------------------------------------

interface AgentSeed {
  username: string;
  github_repo: string;
  asset_class: "stocks" | "crypto" | "both";
  initial_equity: number;
  equity: number;
  total_deposits: number;
  total_pnl: number;
  total_pnl_pct: number;
  sharpe_ratio: number;
  win_rate: number;
  max_drawdown_pct: number;
  num_trades: number;
  num_winning_trades: number;
  composite_score: number;
  open_positions: number;
  unrealized_pnl: number;
  realized_pnl: number;
  day_pnl: number;
  cash: number;
  joined_days_ago: number;
  seed: number;
  symbols: string[];
  /** Simulates a trader whose first sync is still in progress */
  _pendingSync?: boolean;
  /** Simulates a trader with insufficient data for composite score */
  _nullScore?: boolean;
}

const AGENTS: AgentSeed[] = [
  {
    username: "fresh_start",
    github_repo: "https://github.com/fresh-start/mahoraga-agent",
    asset_class: "stocks",
    initial_equity: 100000,
    equity: 100000,
    total_deposits: 100000,
    total_pnl: 0,
    total_pnl_pct: 0,
    sharpe_ratio: 0,
    win_rate: 0,
    max_drawdown_pct: 0,
    num_trades: 0,
    num_winning_trades: 0,
    composite_score: 0, // Will be set to null in output
    open_positions: 0,
    unrealized_pnl: 0,
    realized_pnl: 0,
    day_pnl: 0,
    cash: 100000,
    joined_days_ago: 1,
    seed: 9009,
    symbols: ["AAPL", "MSFT"],
    _pendingSync: true,
  },
  {
    username: "new_trader",
    github_repo: "https://github.com/new-trader/mahoraga-agent",
    asset_class: "crypto",
    initial_equity: 100000,
    equity: 101500,
    total_deposits: 100000,
    total_pnl: 1500,
    total_pnl_pct: 1.5,
    sharpe_ratio: 0.8,
    win_rate: 55,
    max_drawdown_pct: 2.1,
    num_trades: 12,
    num_winning_trades: 7,
    composite_score: 0, // Will be set to null in output (not enough data yet)
    open_positions: 1,
    unrealized_pnl: 200,
    realized_pnl: 1300,
    day_pnl: 150,
    cash: 85000,
    joined_days_ago: 3,
    seed: 9010,
    symbols: ["BTC/USD", "ETH/USD"],
    _nullScore: true,
  },
  {
    username: "signal_alpha",
    github_repo: "https://github.com/signal-alpha/mahoraga-agent",
    asset_class: "stocks",
    initial_equity: 70000,
    equity: 142300,
    total_deposits: 100000,
    total_pnl: 42300,
    total_pnl_pct: 42.3,
    sharpe_ratio: 2.15,
    win_rate: 58.2,
    max_drawdown_pct: 8.3,
    num_trades: 187,
    num_winning_trades: 109,
    composite_score: 88.4,
    open_positions: 5,
    unrealized_pnl: 3200,
    realized_pnl: 39100,
    day_pnl: 1250,
    cash: 28500,
    joined_days_ago: 120,
    seed: 1001,
    symbols: ["NVDA", "AAPL", "MSFT", "TSLA", "AMD", "META", "GOOG", "AMZN"],
  },
  {
    username: "entropy_bot",
    github_repo: "https://github.com/entropy-bot/mahoraga-agent",
    asset_class: "crypto",
    initial_equity: 68000,
    equity: 131700,
    total_deposits: 100000,
    total_pnl: 31700,
    total_pnl_pct: 31.7,
    sharpe_ratio: 1.62,
    win_rate: 52.1,
    max_drawdown_pct: 18.5,
    num_trades: 342,
    num_winning_trades: 178,
    composite_score: 72.1,
    open_positions: 3,
    unrealized_pnl: -1800,
    realized_pnl: 33500,
    day_pnl: -420,
    cash: 41200,
    joined_days_ago: 95,
    seed: 2002,
    symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD", "AVAX/USD"],
  },
  {
    username: "quant_zen",
    github_repo: "https://github.com/quant-zen/mahoraga-agent",
    asset_class: "both",
    initial_equity: 81000,
    equity: 118900,
    total_deposits: 100000,
    total_pnl: 18900,
    total_pnl_pct: 18.9,
    sharpe_ratio: 2.85,
    win_rate: 64.3,
    max_drawdown_pct: 4.2,
    num_trades: 98,
    num_winning_trades: 63,
    composite_score: 91.2,
    open_positions: 4,
    unrealized_pnl: 1100,
    realized_pnl: 17800,
    day_pnl: 380,
    cash: 52100,
    joined_days_ago: 150,
    seed: 3003,
    symbols: ["AAPL", "BTC/USD", "MSFT", "ETH/USD", "GOOG", "SOL/USD"],
  },
  {
    username: "momentum_x",
    github_repo: "https://github.com/momentum-x/mahoraga-agent",
    asset_class: "stocks",
    initial_equity: 45000,
    equity: 155100,
    total_deposits: 100000,
    total_pnl: 55100,
    total_pnl_pct: 55.1,
    sharpe_ratio: 1.08,
    win_rate: 47.5,
    max_drawdown_pct: 24.1,
    num_trades: 412,
    num_winning_trades: 196,
    composite_score: 65.3,
    open_positions: 8,
    unrealized_pnl: 8900,
    realized_pnl: 46200,
    day_pnl: 2340,
    cash: 18200,
    joined_days_ago: 110,
    seed: 4004,
    symbols: ["TSLA", "NVDA", "AMD", "MARA", "RIOT", "PLTR", "SOFI", "COIN"],
  },
  {
    username: "deep_signal",
    github_repo: "https://github.com/deep-signal/mahoraga-agent",
    asset_class: "crypto",
    initial_equity: 88000,
    equity: 112400,
    total_deposits: 100000,
    total_pnl: 12400,
    total_pnl_pct: 12.4,
    sharpe_ratio: 1.35,
    win_rate: 51.8,
    max_drawdown_pct: 11.7,
    num_trades: 156,
    num_winning_trades: 81,
    composite_score: 58.7,
    open_positions: 2,
    unrealized_pnl: -650,
    realized_pnl: 13050,
    day_pnl: 190,
    cash: 45800,
    joined_days_ago: 80,
    seed: 5005,
    symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "LINK/USD", "DOT/USD"],
  },
  {
    username: "grid_master",
    github_repo: "https://github.com/grid-master/mahoraga-agent",
    asset_class: "both",
    initial_equity: 92000,
    equity: 108200,
    total_deposits: 100000,
    total_pnl: 8200,
    total_pnl_pct: 8.2,
    sharpe_ratio: 1.92,
    win_rate: 71.2,
    max_drawdown_pct: 3.8,
    num_trades: 524,
    num_winning_trades: 373,
    composite_score: 76.5,
    open_positions: 6,
    unrealized_pnl: 420,
    realized_pnl: 7780,
    day_pnl: 85,
    cash: 35600,
    joined_days_ago: 170,
    seed: 6006,
    symbols: ["AAPL", "MSFT", "BTC/USD", "ETH/USD", "GOOG", "SOL/USD"],
  },
  {
    username: "trend_rider",
    github_repo: "https://github.com/trend-rider/mahoraga-agent",
    asset_class: "stocks",
    initial_equity: 78000,
    equity: 122600,
    total_deposits: 100000,
    total_pnl: 22600,
    total_pnl_pct: 22.6,
    sharpe_ratio: 1.74,
    win_rate: 55.9,
    max_drawdown_pct: 9.4,
    num_trades: 143,
    num_winning_trades: 80,
    composite_score: 74.8,
    open_positions: 3,
    unrealized_pnl: 2100,
    realized_pnl: 20500,
    day_pnl: 670,
    cash: 38900,
    joined_days_ago: 130,
    seed: 7007,
    symbols: ["NVDA", "AAPL", "MSFT", "META", "AMZN", "CRM"],
  },
  {
    username: "dip_hunter",
    github_repo: "https://github.com/dip-hunter/mahoraga-agent",
    asset_class: "crypto",
    initial_equity: 85000,
    equity: 115300,
    total_deposits: 100000,
    total_pnl: 15300,
    total_pnl_pct: 15.3,
    sharpe_ratio: 1.41,
    win_rate: 60.5,
    max_drawdown_pct: 13.2,
    num_trades: 215,
    num_winning_trades: 130,
    composite_score: 62.9,
    open_positions: 4,
    unrealized_pnl: -920,
    realized_pnl: 16220,
    day_pnl: -310,
    cash: 32400,
    joined_days_ago: 100,
    seed: 8008,
    symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "MATIC/USD"],
  },
];

// ---------------------------------------------------------------------------
// Generated Data
// ---------------------------------------------------------------------------

function buildJoinedAt(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function buildLastSyncedAt(): string {
  const d = new Date();
  d.setHours(d.getHours() - 1);
  return d.toISOString();
}

function buildSnapshotDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildTrades(agent: AgentSeed): Trade[] {
  const rng = seededRandom(agent.seed + 100);
  const count = 15 + Math.floor(rng() * 6); // 15-20 trades
  const trades: Trade[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const symbolIdx = Math.floor(rng() * agent.symbols.length);
    const symbol = agent.symbols[symbolIdx];
    const isCrypto = symbol.includes("/");
    const side: "buy" | "sell" = rng() > 0.5 ? "buy" : "sell";

    let price: number;
    if (isCrypto) {
      if (symbol.startsWith("BTC")) price = 40000 + rng() * 25000;
      else if (symbol.startsWith("ETH")) price = 2200 + rng() * 1500;
      else if (symbol.startsWith("SOL")) price = 80 + rng() * 120;
      else price = 5 + rng() * 50;
    } else {
      if (symbol === "NVDA") price = 110 + rng() * 40;
      else if (symbol === "AAPL") price = 170 + rng() * 30;
      else if (symbol === "MSFT") price = 380 + rng() * 40;
      else if (symbol === "TSLA") price = 180 + rng() * 80;
      else if (symbol === "AMD") price = 130 + rng() * 30;
      else if (symbol === "META") price = 480 + rng() * 40;
      else if (symbol === "GOOG") price = 150 + rng() * 20;
      else if (symbol === "AMZN") price = 175 + rng() * 25;
      else price = 20 + rng() * 100;
    }

    const qty = isCrypto
      ? Math.round((0.01 + rng() * 2) * 1000) / 1000
      : Math.round(1 + rng() * 50);

    const filledAt = new Date(
      now - (i + 1) * (1000 * 60 * 60 * (2 + rng() * 22))
    ).toISOString();

    trades.push({
      symbol,
      side,
      qty,
      price: Math.round(price * 100) / 100,
      filled_at: filledAt,
      asset_class: isCrypto ? "crypto" : "us_equity",
    });
  }

  return trades;
}

function buildEquityHistory(agent: AgentSeed): EquityPoint[] {
  const curve = generateEquityCurve(
    agent.initial_equity,
    agent.equity,
    90,
    agent.seed
  );
  const timestamps = generateTimestamps(90);

  return curve.map((eq, i) => ({
    timestamp: timestamps[i],
    equity: eq,
    profit_loss: eq - agent.total_deposits,
    profit_loss_pct:
      Math.round(((eq - agent.total_deposits) / agent.total_deposits) * 1000) /
      10,
  }));
}

function buildSparkline(agent: AgentSeed): number[] {
  return generateEquityCurve(agent.initial_equity, agent.equity, 29, agent.seed + 50);
}

// ---------------------------------------------------------------------------
// Exported Mock Data
// ---------------------------------------------------------------------------

const snapshotDate = buildSnapshotDate();
const lastSyncedAt = buildLastSyncedAt();

export const mockTraders: TraderRow[] = AGENTS.map((a) => ({
  username: a.username,
  github_repo: a.github_repo,
  asset_class: a.asset_class,
  joined_at: buildJoinedAt(a.joined_days_ago),
  equity: a._pendingSync ? null : a.equity,
  total_pnl: a._pendingSync ? null : a.total_pnl,
  total_pnl_pct: a._pendingSync ? null : a.total_pnl_pct,
  total_deposits: a._pendingSync ? null : a.total_deposits,
  sharpe_ratio: a._pendingSync ? null : a.sharpe_ratio,
  win_rate: a._pendingSync ? null : a.win_rate,
  max_drawdown_pct: a._pendingSync ? null : a.max_drawdown_pct,
  num_trades: a._pendingSync ? null : a.num_trades,
  composite_score: (a._pendingSync || a._nullScore) ? null : a.composite_score,
  open_positions: a._pendingSync ? null : a.open_positions,
  snapshot_date: a._pendingSync ? null : snapshotDate,
  sparkline: a._pendingSync ? [] : buildSparkline(a),
  pending_sync: a._pendingSync ? 1 : undefined,
}));

export const mockProfiles: Record<string, TraderProfile> = Object.fromEntries(
  AGENTS.map((a) => [
    a.username,
    {
      trader: {
        id: `mock-${a.username}`,
        username: a.username,
        github_repo: a.github_repo,
        asset_class: a.asset_class,
        joined_at: buildJoinedAt(a.joined_days_ago),
        last_synced_at: a._pendingSync ? null : lastSyncedAt,
      },
      snapshot: a._pendingSync ? null : {
        equity: a.equity,
        cash: a.cash,
        total_deposits: a.total_deposits,
        total_pnl: a.total_pnl,
        total_pnl_pct: a.total_pnl_pct,
        unrealized_pnl: a.unrealized_pnl,
        realized_pnl: a.realized_pnl,
        day_pnl: a.day_pnl,
        num_trades: a.num_trades,
        num_winning_trades: a.num_winning_trades,
        win_rate: a.win_rate,
        max_drawdown_pct: a.max_drawdown_pct,
        sharpe_ratio: a.sharpe_ratio,
        open_positions: a.open_positions,
        composite_score: a._nullScore ? null : a.composite_score,
        snapshot_date: snapshotDate,
      },
    },
  ])
);

export const mockTrades: Record<string, Trade[]> = Object.fromEntries(
  AGENTS.map((a) => [a.username, buildTrades(a)])
);

export const mockEquity: Record<string, EquityPoint[]> = Object.fromEntries(
  AGENTS.map((a) => [a.username, buildEquityHistory(a)])
);

export const mockStats: LeaderboardStats = {
  total_traders: AGENTS.length,
  total_trades: AGENTS.reduce((sum, a) => sum + a.num_trades, 0),
  total_pnl: AGENTS.reduce((sum, a) => sum + a.total_pnl, 0),
};
