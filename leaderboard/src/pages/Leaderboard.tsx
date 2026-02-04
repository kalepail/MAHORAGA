import { useState, useEffect, useCallback, useRef } from "react";
import clsx from "clsx";
import type {
  TraderRow,
  LeaderboardStats,
  LeaderboardResponse,
  SortField,
  SortDir,
} from "../types";
import { AssetBadge } from "../components/AssetBadge";
import { Sparkline } from "../components/Sparkline";
import { InfoIcon } from "../components/Tooltip";
import { pnlColor, formatPercent, formatPnl, formatMetric } from "../utils";
import { METRIC_TOOLTIPS, SORT_TOOLTIPS } from "../constants/tooltips";
import { FULL_BRAND_NAME } from "../branding";

interface LeaderboardProps {
  navigate: (path: string) => void;
}

/** Natural (first-click) direction for each column. MDD is ASC (lower = better). */
const NATURAL_DIR: Record<SortField, SortDir> = {
  composite_score: "desc",
  total_pnl_pct: "desc",
  total_pnl: "desc",
  sharpe_ratio: "desc",
  win_rate: "desc",
  max_drawdown_pct: "asc",
  num_trades: "desc",
};

const TRADERS_PER_PAGE = 100;

// ---------------------------------------------------------------------------
// Sort Arrow SVG
// ---------------------------------------------------------------------------

function SortArrow({ dir }: { dir: SortDir }) {
  return (
    <svg
      width="8"
      height="10"
      viewBox="0 0 8 10"
      fill="currentColor"
      className="inline-block ml-1 opacity-80"
    >
      {dir === "asc" ? (
        <path d="M4 0L8 6H0L4 0Z" />
      ) : (
        <path d="M4 10L0 4H8L4 10Z" />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sortable Header
// ---------------------------------------------------------------------------

interface SortableHeaderProps {
  label: string;
  field: SortField;
  tooltip: React.ReactNode;
  activeSort: SortField;
  activeDir: SortDir;
  onSort: (field: SortField) => void;
}

function SortableHeader({
  label,
  field,
  tooltip,
  activeSort,
  activeDir,
  onSort,
}: SortableHeaderProps) {
  const isActive = activeSort === field;
  return (
    <th
      className="hud-label text-right px-4 py-3 cursor-pointer select-none hover:text-hud-text-bright transition-colors"
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {isActive && <SortArrow dir={activeDir} />}
        <InfoIcon tooltip={tooltip} />
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function Leaderboard({ navigate }: LeaderboardProps) {
  const [sort, setSort] = useState<SortField>("composite_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [traders, setTraders] = useState<TraderRow[]>([]);
  const [stats, setStats] = useState<LeaderboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Sort toggle cycle:
   * 1st click on a column → natural direction (DESC for most, ASC for MDD)
   * 2nd click on same column → opposite direction
   * 3rd click on same column → reset to default (composite_score DESC)
   */
  const handleColumnSort = useCallback(
    (field: SortField) => {
      if (sort !== field) {
        // Clicking a new column: set to its natural direction
        setSort(field);
        setSortDir(NATURAL_DIR[field]);
      } else if (sortDir === NATURAL_DIR[field]) {
        // Same column, currently natural: flip direction
        setSortDir(NATURAL_DIR[field] === "desc" ? "asc" : "desc");
      } else {
        // Same column, already flipped: reset to default
        setSort("composite_score");
        setSortDir("desc");
      }
    },
    [sort, sortDir]
  );

  const fetchLeaderboard = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setOffset(0);
    try {
      const params = new URLSearchParams({
        sort,
        sort_dir: sortDir,
        limit: String(TRADERS_PER_PAGE),
      });
      const res = await fetch(`/api/leaderboard?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Failed to load leaderboard");
      const data: LeaderboardResponse = await res.json();
      setTraders(data.traders);
      setHasMore(data.traders.length === TRADERS_PER_PAGE);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [sort, sortDir]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const newOffset = offset + TRADERS_PER_PAGE;
    try {
      const params = new URLSearchParams({
        sort,
        sort_dir: sortDir,
        limit: String(TRADERS_PER_PAGE),
        offset: String(newOffset),
      });
      const res = await fetch(`/api/leaderboard?${params}`);
      if (res.ok) {
        const data: LeaderboardResponse = await res.json();
        setTraders((prev) => [...prev, ...data.traders]);
        setOffset(newOffset);
        setHasMore(data.traders.length === TRADERS_PER_PAGE);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard/stats");
      if (!res.ok) return;
      const data: LeaderboardStats = await res.json();
      setStats(data);
    } catch {
      // Stats are non-critical
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    return () => abortRef.current?.abort();
  }, [fetchLeaderboard]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div>
      <title>{`Algorithmic Trading Bot Leaderboard | AI Trading Agent Competition | ${FULL_BRAND_NAME}`}</title>
      {stats?.last_updated && (
        <div className="hud-label text-hud-text-dim mb-2">
          Last updated:{" "}
          {new Date(stats.last_updated).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </div>
      )}
      {/* Stats bar */}
      {stats && <StatsBar stats={stats} />}

      {/* Table */}
      <div className="hud-panel overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-hud-line">
              <th className="hud-label text-left px-4 py-3 w-[50px]">#</th>
              <th className="hud-label text-left px-4 py-3">
                <span className="inline-flex items-center gap-1.5">
                  Agent
                  <InfoIcon tooltip={METRIC_TOOLTIPS.agentBadge} />
                </span>
              </th>
              <SortableHeader label="Score" field="composite_score" tooltip={SORT_TOOLTIPS.composite_score} activeSort={sort} activeDir={sortDir} onSort={handleColumnSort} />
              <SortableHeader label="ROI %" field="total_pnl_pct" tooltip={SORT_TOOLTIPS.total_pnl_pct} activeSort={sort} activeDir={sortDir} onSort={handleColumnSort} />
              <SortableHeader label="P&L" field="total_pnl" tooltip={SORT_TOOLTIPS.total_pnl} activeSort={sort} activeDir={sortDir} onSort={handleColumnSort} />
              <SortableHeader label="Sharpe" field="sharpe_ratio" tooltip={SORT_TOOLTIPS.sharpe_ratio} activeSort={sort} activeDir={sortDir} onSort={handleColumnSort} />
              <SortableHeader label="Win Rate" field="win_rate" tooltip={SORT_TOOLTIPS.win_rate} activeSort={sort} activeDir={sortDir} onSort={handleColumnSort} />
              <SortableHeader label="MDD" field="max_drawdown_pct" tooltip={SORT_TOOLTIPS.max_drawdown_pct} activeSort={sort} activeDir={sortDir} onSort={handleColumnSort} />
              <SortableHeader label="Trades" field="num_trades" tooltip={SORT_TOOLTIPS.num_trades} activeSort={sort} activeDir={sortDir} onSort={handleColumnSort} />
              <th className="hud-label text-right px-4 py-3 w-[100px]">
                <span className="inline-flex items-center gap-1.5">
                  Equity Trend <InfoIcon tooltip={METRIC_TOOLTIPS.equityCurve} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <span className="hud-label">Loading...</span>
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <span className="hud-value-sm text-hud-error" role="alert">
                    {error}
                  </span>
                  <div className="mt-2">
                    <button
                      onClick={fetchLeaderboard}
                      className="hud-button text-[10px]"
                    >
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!loading && !error && traders.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <span className="hud-label">No agents found</span>
                  <div className="mt-2">
                    <button
                      onClick={() => navigate("/join")}
                      className="hud-button text-[10px]"
                    >
                      Be the first
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              traders.map((trader, i) => (
                <LeaderboardRow
                  key={trader.username}
                  trader={trader}
                  rank={i + 1}
                  isOdd={i % 2 === 1}
                  onClick={() => navigate(`/trader/${trader.username}`)}
                />
              ))}
            {loadingMore && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center">
                  <span className="hud-label">Loading...</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Load More */}
      {!loading && !error && hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="hud-button text-[11px]"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extracted Components
// ---------------------------------------------------------------------------

function StatsBar({ stats }: { stats: LeaderboardStats }) {
  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      <div className="hud-panel px-4 py-3">
        <div className="hud-label flex items-center gap-1.5">
          Agents
          <InfoIcon tooltip={METRIC_TOOLTIPS.agents} />
        </div>
        <div className="hud-value-md mt-1 text-hud-text-bright">
          {stats.total_traders}
        </div>
      </div>
      <div className="hud-panel px-4 py-3">
        <div className="hud-label flex items-center gap-1.5">
          Trades
          <InfoIcon tooltip={METRIC_TOOLTIPS.trades} />
        </div>
        <div className="hud-value-md mt-1 text-hud-text-bright">
          {stats.total_trades.toLocaleString()}
        </div>
      </div>
      <div className="hud-panel px-4 py-3">
        <div className="hud-label flex items-center gap-1.5">
          Combined P&L
          <InfoIcon tooltip={METRIC_TOOLTIPS.combinedPnl} />
        </div>
        <div className={clsx("hud-value-md mt-1", pnlColor(stats.total_pnl))}>
          {formatPnl(stats.total_pnl)}
        </div>
      </div>
    </div>
  );
}

interface LeaderboardRowProps {
  trader: TraderRow;
  rank: number;
  isOdd: boolean;
  onClick: () => void;
}

function LeaderboardRow({ trader, rank, isOdd, onClick }: LeaderboardRowProps) {
  const syncing = !!trader.pending_sync;
  // Account has data but score not yet computed by cron (runs every 15 min)
  const isNew = !syncing && trader.composite_score === null;
  const unranked = syncing || isNew;

  return (
    <tr
      className={clsx(
        "border-b border-hud-line/50 hover:bg-hud-bg-panel/50 cursor-pointer transition-colors",
        isOdd && "bg-hud-bg-row-odd"
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="link"
    >
      <td className="px-4 py-3">
        <span
          className={clsx(
            "text-[13px] font-medium",
            unranked
              ? "text-hud-text-dim"
              : rank === 1
                ? "text-rank-gold"
                : rank === 2
                  ? "text-rank-silver"
                  : rank === 3
                    ? "text-rank-bronze"
                    : "text-hud-text-dim"
          )}
        >
          {unranked ? "--" : rank}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="hud-value-sm text-hud-text-bright">
            {trader.username}
          </span>
          {syncing ? (
            <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 border border-hud-warning/50 text-hud-warning">
              Syncing
            </span>
          ) : (
            <>
              <AssetBadge assetClass={trader.asset_class} />
              {isNew && (
                <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 border border-hud-success/50 text-hud-success">
                  New
                </span>
              )}
            </>
          )}
        </div>
      </td>
      {syncing ? (
        <td colSpan={8} className="px-4 py-3">
          <span className="hud-label">
            Initial sync in progress — data will appear shortly
          </span>
        </td>
      ) : (
        <>
          <td className="px-4 py-3 text-right">
            <span className="hud-value-sm text-hud-text-bright">
              {formatMetric(trader.composite_score)}
            </span>
          </td>
          <td className="px-4 py-3 text-right">
            <span className={clsx("hud-value-sm", pnlColor(trader.total_pnl_pct ?? 0))}>
              {formatPercent(trader.total_pnl_pct ?? 0)}
            </span>
          </td>
          <td className="px-4 py-3 text-right">
            <span className={clsx("hud-value-sm", pnlColor(trader.total_pnl ?? 0))}>
              {formatPnl(trader.total_pnl ?? 0)}
            </span>
          </td>
          <td className="px-4 py-3 text-right">
            <span className="hud-value-sm">
              {formatMetric(trader.sharpe_ratio, 2)}
            </span>
          </td>
          <td className="px-4 py-3 text-right">
            <span className="hud-value-sm">
              {formatMetric(trader.win_rate, 1, "%")}
            </span>
          </td>
          <td className="px-4 py-3 text-right">
            <span className="hud-value-sm text-hud-error">
              {formatMetric(trader.max_drawdown_pct, 1, "%")}
            </span>
          </td>
          <td className="px-4 py-3 text-right">
            <span className="hud-value-sm">{trader.num_trades ?? 0}</span>
          </td>
          <td className="px-4 py-3 text-right">
            <Sparkline
              data={trader.sparkline}
              positive={(trader.total_pnl_pct ?? 0) >= 0}
            />
          </td>
        </>
      )}
    </tr>
  );
}
