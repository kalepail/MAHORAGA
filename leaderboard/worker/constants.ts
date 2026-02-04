/**
 * Shared constants and normalization helpers for the leaderboard worker.
 */

// ---------------------------------------------------------------------------
// Sort fields (single source of truth for API + frontend)
// ---------------------------------------------------------------------------

/** Allowed sort columns for the leaderboard API. Must match SortField in src/types.ts. */
export const SORT_FIELDS = [
  "composite_score",
  "total_pnl_pct",
  "total_pnl",
  "sharpe_ratio",
  "win_rate",
  "max_drawdown_pct",
  "num_trades",
] as const;

export type SortField = (typeof SORT_FIELDS)[number];

// ---------------------------------------------------------------------------
// Asset class types & normalization
// ---------------------------------------------------------------------------

/** Raw asset_class values from the Alpaca API (e.g. on positions/orders). */
export type AlpacaAssetClass = "us_equity" | "crypto";

/** Derived asset class stored on trader rows and used in leaderboard filters. */
export type DerivedAssetClass = "stocks" | "crypto" | "both";

/** Asset class stored on individual trade rows. */
export type TradeAssetClass = "stocks" | "crypto";

/**
 * Normalize a raw Alpaca asset_class value to our trade-level classification.
 * "us_equity" (or anything non-crypto) -> "stocks", "crypto" -> "crypto".
 */
export function normalizeAlpacaAssetClass(raw: string | undefined): TradeAssetClass {
  if (raw === "crypto") return "crypto";
  if (raw !== undefined && raw !== "us_equity") {
    console.warn(`[constants] Unknown Alpaca asset_class: "${raw}", defaulting to "stocks"`);
  }
  return "stocks";
}

/**
 * Derive a trader's overall asset class from their positions and recent orders.
 *
 * This is a sticky classification: once a trader has both stocks and crypto,
 * they stay as "both" even if they later only trade one.
 */
export function deriveTraderAssetClass(
  positions: { asset_class: string }[],
  orders: { asset_class: string }[]
): DerivedAssetClass {
  const hasCrypto =
    positions.some((p) => p.asset_class === "crypto") ||
    orders.some((o) => o.asset_class === "crypto");
  const hasStocks =
    positions.some((p) => p.asset_class !== "crypto") ||
    orders.some((o) => o.asset_class !== "crypto");

  if (hasCrypto && hasStocks) return "both";
  if (hasCrypto) return "crypto";
  return "stocks";
}
