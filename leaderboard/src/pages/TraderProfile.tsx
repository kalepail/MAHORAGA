import { useState, useEffect, useRef } from "react";
import type { TraderProfile as TraderProfileType, Trade, EquityPoint } from "../types";
import { MetricCard } from "../components/MetricCard";
import { AssetBadge } from "../components/AssetBadge";
import { Sparkline } from "../components/Sparkline";
import { InfoIcon } from "../components/Tooltip";
import { formatPercent, formatPnl, formatCurrency, formatMetric } from "../utils";
import { METRIC_TOOLTIPS } from "../constants/tooltips";
import { FULL_BRAND_NAME } from "../branding";
import clsx from "clsx";

interface TraderProfileProps {
  username: string;
  navigate: (path: string) => void;
}

const TRADES_PER_PAGE = 100;

export function TraderProfile({ username, navigate }: TraderProfileProps) {
  const [profile, setProfile] = useState<TraderProfileType | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [justRegistered, setJustRegistered] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Detect ?registered=true from registration OAuth callback redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "true") {
      setJustRegistered(true);
      // Clean the URL without triggering navigation
      window.history.replaceState(null, "", `/trader/${username}`);
    }

    // Scroll to top on navigation
    window.scrollTo(0, 0);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/trader/${username}`, { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Agent not found" : "Failed to load profile");
        return r.json() as Promise<TraderProfileType>;
      }),
      fetch(`/api/trader/${username}/trades?limit=${TRADES_PER_PAGE}`, { signal: controller.signal }).then((r) => {
        if (!r.ok) return { trades: [] };
        return r.json() as Promise<{ trades: Trade[] }>;
      }),
      fetch(`/api/trader/${username}/equity?days=90`, { signal: controller.signal }).then((r) => {
        if (!r.ok) return { equity: [] };
        return r.json() as Promise<{ equity: EquityPoint[] }>;
      }),
    ])
      .then(([profileData, tradesData, equityData]) => {
        setProfile(profileData);
        setTrades(tradesData.trades);
        setEquity(equityData.equity);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [username]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <title>{`${username} | AI Trading Bot Performance | ${FULL_BRAND_NAME}`}</title>
        <span className="hud-label">Loading...</span>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="text-center py-20">
        <title>{`${username} | AI Trading Bot Performance | ${FULL_BRAND_NAME}`}</title>
        <div className="hud-value-md text-hud-text-dim" role="alert">
          {error || "Agent not found"}
        </div>
        <button onClick={() => navigate("/")} className="hud-button mt-4">
          Back to Leaderboard
        </button>
      </div>
    );
  }

  const { trader, snapshot } = profile;
  const equityCurve = equity.map((e) => e.equity);

  return (
    <div>
      <title>{`${trader.username} | AI Trading Bot Performance | ${FULL_BRAND_NAME}`}</title>
      {/* Back link */}
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
        className="text-[11px] text-hud-text-dim hover:text-hud-text uppercase tracking-[0.1em] mb-4 inline-block"
      >
        &larr; Leaderboard
      </a>

      {/* Header */}
      <div className="hud-panel p-6 mb-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="hud-value-lg">{trader.username}</span>
              <AssetBadge assetClass={trader.asset_class} />
            </div>
            <div className="flex items-center gap-4 mt-3">
              <span className="hud-label">
                Joined{" "}
                {new Date(trader.joined_at).toLocaleDateString("en-US", {
                  month: "short",
                  year: "numeric",
                })}
              </span>
              {trader.last_synced_at && (
                <span className="hud-label">
                  Last sync{" "}
                  {new Date(trader.last_synced_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              )}
            </div>
          </div>
          <a
            href={trader.github_repo}
            target="_blank"
            rel="noopener noreferrer"
            className="hud-button text-[10px]"
          >
            View Code
          </a>
        </div>
      </div>

      {/* Registration success banner */}
      {justRegistered && (
        <div className="hud-panel p-4 mb-4 border-hud-success/30 bg-hud-success/5">
          <span className="hud-value-sm text-hud-success">
            Registered and connected. Your first sync is in progress — data
            will appear shortly.
          </span>
        </div>
      )}

      {/* Equity curve */}
      {equityCurve.length > 1 && (
        <div className="hud-panel p-4 mb-4">
          <div className="hud-label mb-2 flex items-center gap-1.5">
            Equity Curve
            <InfoIcon tooltip={METRIC_TOOLTIPS.equityCurve} />
          </div>
          <div className="w-full overflow-hidden">
            <Sparkline
              data={equityCurve}
              width="100%"
              height={80}
              positive={snapshot ? snapshot.total_pnl_pct >= 0 : true}
            />
          </div>
        </div>
      )}

      {/* Metrics grid */}
      {snapshot && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
            <MetricCard
              label="ROI"
              value={formatPercent(snapshot.total_pnl_pct, 2)}
              positive={snapshot.total_pnl_pct >= 0}
              tooltip={METRIC_TOOLTIPS.roi}
            />
            <MetricCard
              label="Total P&L"
              value={formatPnl(snapshot.total_pnl)}
              sub={`on ${formatCurrency(snapshot.total_deposits)} starting capital`}
              positive={snapshot.total_pnl >= 0}
              tooltip={METRIC_TOOLTIPS.pnl}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={formatMetric(snapshot.sharpe_ratio, 2)}
              tooltip={METRIC_TOOLTIPS.sharpe}
            />
            <MetricCard
              label="Composite Score"
              value={formatMetric(snapshot.composite_score)}
              tooltip={METRIC_TOOLTIPS.score}
            />
            <MetricCard
              label="Win Rate"
              value={formatMetric(snapshot.win_rate, 1, "%")}
              sub={snapshot.win_rate !== null ? `${snapshot.num_winning_trades} winning days` : undefined}
              tooltip={METRIC_TOOLTIPS.winRate}
            />
            <MetricCard
              label="Max Drawdown"
              value={formatMetric(snapshot.max_drawdown_pct, 1, "%")}
              positive={false}
              tooltip={METRIC_TOOLTIPS.maxDrawdown}
            />
            <MetricCard
              label="Trades"
              value={formatMetric(snapshot.num_trades)}
              tooltip={METRIC_TOOLTIPS.trades}
            />
            <MetricCard
              label="Today"
              value={formatPnl(snapshot.day_pnl)}
              positive={snapshot.day_pnl >= 0}
              tooltip={METRIC_TOOLTIPS.dayPnl}
            />
            <MetricCard
              label="Open Positions"
              value={String(snapshot.open_positions)}
              tooltip={METRIC_TOOLTIPS.openPositions}
            />
            <MetricCard
              label="Equity"
              value={formatCurrency(snapshot.equity)}
              tooltip={METRIC_TOOLTIPS.equity}
            />
            <MetricCard
              label="Unrealized P&L"
              value={formatPnl(snapshot.unrealized_pnl)}
              positive={snapshot.unrealized_pnl >= 0}
              tooltip={METRIC_TOOLTIPS.unrealizedPnl}
            />
            <MetricCard
              label="Realized P&L"
              value={formatPnl(snapshot.realized_pnl)}
              positive={snapshot.realized_pnl >= 0}
              tooltip={METRIC_TOOLTIPS.realizedPnl}
            />
          </div>
        </>
      )}

      {!snapshot && (
        <div className="hud-panel p-6 mb-4 text-center">
          <span className="hud-label">
            No performance data yet. Data will appear after the next sync cycle.
          </span>
        </div>
      )}

      {/* Trade history */}
      <TradeHistoryTable trades={trades} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extracted Component
// ---------------------------------------------------------------------------

interface TradeHistoryTableProps {
  trades: Trade[];
}

function TradeHistoryTable({ trades }: TradeHistoryTableProps) {
  // Group trades by symbol, preserving time order within each group
  const groupedTrades = trades.reduce<Record<string, Trade[]>>((acc, trade) => {
    const key = trade.symbol;
    if (!acc[key]) acc[key] = [];
    acc[key].push(trade);
    return acc;
  }, {});

  // Sort groups by most recent trade (first trade in each group since they're already time-sorted)
  const sortedGroups = Object.keys(groupedTrades).sort((a, b) => {
    const aTime = new Date(groupedTrades[a][0].filled_at).getTime();
    const bTime = new Date(groupedTrades[b][0].filled_at).getTime();
    return bTime - aTime;
  });

  return (
    <div className="hud-panel">
      <div className="px-4 py-3 border-b border-hud-line">
        <span className="hud-label inline-flex items-center gap-1.5">
          Recent Trades
          <InfoIcon tooltip={METRIC_TOOLTIPS.recentTrades} />
        </span>
        {trades.length > 0 && (
          <span className="hud-label text-hud-text-dim ml-2">({trades.length})</span>
        )}
      </div>
      {trades.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <span className="hud-label">No trades recorded yet</span>
        </div>
      ) : (
        <>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-hud-line">
                <th className="hud-label text-left px-4 py-2 w-[30%]">Symbol</th>
                <th className="hud-label text-left px-4 py-2 w-[15%]">Side</th>
                <th className="hud-label text-right px-4 py-2 w-[20%]">
                  <span className="inline-flex items-center gap-1.5">
                    Qty <InfoIcon tooltip={METRIC_TOOLTIPS.tradeQty} />
                  </span>
                </th>
                <th className="hud-label text-right px-4 py-2 w-[15%]">
                  <span className="inline-flex items-center gap-1.5">
                    Price <InfoIcon tooltip={METRIC_TOOLTIPS.tradePrice} />
                  </span>
                </th>
                <th className="hud-label text-right px-4 py-2 w-[20%]">
                  <span className="inline-flex items-center gap-1.5">
                    Time <InfoIcon tooltip={METRIC_TOOLTIPS.tradeTime} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedGroups.map((symbol, groupIndex) => (
                <>
                  <tr key={`header-${symbol}`} className="border-t border-hud-line border-b border-hud-line/50 bg-hud-bg-row-header">
                    {/* Extra top padding after first group for visual separation between symbol blocks */}
                    <td colSpan={5} className={clsx("px-4 pb-2", groupIndex === 0 ? "pt-2" : "pt-5")}>
                      <span className="hud-value-sm text-hud-text-bright">
                        {symbol}
                      </span>
                      <span className="hud-label text-hud-text-dim ml-2">
                        ({groupedTrades[symbol].length} trade{groupedTrades[symbol].length !== 1 ? "s" : ""})
                      </span>
                    </td>
                  </tr>
                  {groupedTrades[symbol].map((trade, i) => (
                    <tr
                      key={`${symbol}-${i}`}
                      className={clsx(
                        "border-b border-hud-line/50",
                        i % 2 === 1 && "bg-hud-bg-row-odd"
                      )}
                    >
                      <td className="px-4 py-2"></td>
                      <td className="px-4 py-2">
                        <span
                          className={clsx(
                            "hud-value-sm uppercase",
                            trade.side === "buy"
                              ? "text-hud-success"
                              : "text-hud-error"
                          )}
                        >
                          {trade.side}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="hud-value-sm">{trade.qty}</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="hud-value-sm">
                          {formatCurrency(trade.price, 2)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="hud-value-sm text-hud-text-dim">
                          {new Date(trade.filled_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
