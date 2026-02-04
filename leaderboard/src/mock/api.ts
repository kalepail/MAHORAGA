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

function sortTraders(sort: string, dir: SortDir = "desc") {
  const field = sort as NumericKey;
  const copy = [...mockTraders];
  // Match backend COALESCE behavior: NULLs always sort last regardless of direction
  const nullSentinel = dir === "asc" ? Infinity : -Infinity;
  copy.sort((a, b) => {
    const av = a[field] ?? nullSentinel;
    const bv = b[field] ?? nullSentinel;
    if (dir === "asc") return (av as number) - (bv as number);
    return (bv as number) - (av as number);
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
