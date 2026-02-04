import type { LeaderboardResponse, SortField, SortDir } from "../types";
import {
  mockTraders,
  mockProfiles,
  mockTrades,
  mockEquity,
  mockStats,
} from "./data";

// ---------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------

type NumericKey = "composite_score" | "total_pnl_pct" | "total_pnl" | "sharpe_ratio" | "win_rate" | "max_drawdown_pct" | "num_trades";

// Tiebreaker cascade matching the backend ORDER BY.
// Traders with pending_sync always sort last. Then cascading column tiebreakers.
const TIEBREAKER_CASCADE: [NumericKey, SortDir][] = [
  ["composite_score", "desc"],
  ["total_pnl", "desc"],
  ["total_pnl_pct", "desc"],
  ["sharpe_ratio", "desc"],
  ["win_rate", "desc"],
  ["max_drawdown_pct", "asc"],
  ["num_trades", "desc"],
];

/** Compare two numbers using relational ops (safe for all values, avoids subtraction edge cases). */
function cmp(a: number, b: number, dir: SortDir): number {
  if (a < b) return dir === "asc" ? -1 : 1;
  if (a > b) return dir === "asc" ? 1 : -1;
  return 0;
}

function sortTraders(sort: string, dir: SortDir = "desc") {
  const field = sort as NumericKey;
  const copy = [...mockTraders];
  // Match backend COALESCE sentinels: NULLs always sort last
  const sentinel = dir === "asc" ? 999999999 : -999999;

  copy.sort((a, b) => {
    // Primary sort
    const av = (a[field] ?? sentinel) as number;
    const bv = (b[field] ?? sentinel) as number;
    const primary = cmp(av, bv, dir);
    if (primary !== 0) return primary;

    // Pending-sync traders (no data at all) always sort last
    const pa = a.pending_sync ? 1 : 0;
    const pb = b.pending_sync ? 1 : 0;
    if (pa !== pb) return pa - pb;

    // Cascading tiebreakers (skip the primary column)
    for (const [tieField, tieDir] of TIEBREAKER_CASCADE) {
      if (tieField === field) continue;
      const tieSentinel = tieDir === "asc" ? 999999999 : -999999;
      const ta = (a[tieField] ?? tieSentinel) as number;
      const tb = (b[tieField] ?? tieSentinel) as number;
      const diff = cmp(ta, tb, tieDir);
      if (diff !== 0) return diff;
    }

    // Final deterministic tiebreaker (matches backend t.id ASC)
    return a.username.localeCompare(b.username);
  });

  return copy;
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Intercepts fetch calls and returns mock responses for known API routes.
 * Returns `null` if the URL doesn't match any mock route (pass-through).
 */
export function mockFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Response | null {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    window.location.origin
  );
  const path = url.pathname;
  const params = url.searchParams;
  const method = init?.method?.toUpperCase() ?? "GET";

  // GET /api/leaderboard
  if (method === "GET" && path === "/api/leaderboard") {
    const sort: SortField =
      (params.get("sort") as SortField) || "composite_score";
    const sortDir: SortDir =
      (params.get("sort_dir") as SortDir) || "desc";
    const limit = parseInt(params.get("limit") || "100", 10);
    const offset = parseInt(params.get("offset") || "0", 10);

    const sorted = sortTraders(sort, sortDir);
    const traders = sorted.slice(offset, offset + limit);

    const response: LeaderboardResponse = {
      traders,
      meta: {
        limit,
        offset,
        sort,
        sort_dir: sortDir,
      },
    };
    return jsonResponse(response);
  }

  // GET /api/leaderboard/stats
  if (method === "GET" && path === "/api/leaderboard/stats") {
    return jsonResponse(mockStats);
  }

  // GET /api/trader/:username
  const traderMatch = path.match(/^\/api\/trader\/([^/]+)$/);
  if (method === "GET" && traderMatch) {
    const username = decodeURIComponent(traderMatch[1]);
    const profile = mockProfiles[username];
    if (!profile) {
      return jsonResponse({ error: "Agent not found" }, 404);
    }
    return jsonResponse(profile);
  }

  // GET /api/trader/:username/trades
  const tradesMatch = path.match(/^\/api\/trader\/([^/]+)\/trades$/);
  if (method === "GET" && tradesMatch) {
    const username = decodeURIComponent(tradesMatch[1]);
    const trades = mockTrades[username] ?? [];
    const limit = parseInt(params.get("limit") || "50", 10);
    return jsonResponse({
      trades: trades.slice(0, limit),
      meta: { limit, offset: 0 },
    });
  }

  // GET /api/trader/:username/equity
  const equityMatch = path.match(/^\/api\/trader\/([^/]+)\/equity$/);
  if (method === "GET" && equityMatch) {
    const username = decodeURIComponent(equityMatch[1]);
    const equity = mockEquity[username] ?? [];
    const days = parseInt(params.get("days") || "90", 10);
    return jsonResponse({
      equity: equity.slice(-days),
    });
  }

  // POST /api/register
  if (method === "POST" && path === "/api/register") {
    return jsonResponse({ redirect: "#mock-oauth" });
  }

  // Not a mocked route — return null to pass through to real fetch
  return null;
}
