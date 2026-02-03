/**
 * SEO Handler — Dynamic Meta Tags for Trader Profiles
 *
 * Generates meta tag replacements for trader profile pages,
 * enabling rich link previews when shared on social media.
 */

export interface TraderSEOData {
  username: string;
  asset_class: string;
  composite_score: number | null;
  total_pnl_pct: number | null;
  total_pnl: number | null;
  sharpe_ratio: number | null;
  win_rate: number | null;
}

/**
 * Fetch trader data for SEO meta tags
 */
export async function getTraderSEOData(
  username: string,
  env: Env
): Promise<TraderSEOData | null> {
  const row = await env.DB.prepare(
    `WITH latest_snapshot AS (
       SELECT trader_id, composite_score, total_pnl_pct, total_pnl,
              sharpe_ratio, win_rate,
              ROW_NUMBER() OVER (PARTITION BY trader_id ORDER BY snapshot_date DESC) AS rn
       FROM performance_snapshots
     )
     SELECT t.username, t.asset_class,
            s.composite_score, s.total_pnl_pct, s.total_pnl,
            s.sharpe_ratio, s.win_rate
     FROM traders t
     LEFT JOIN latest_snapshot s ON s.trader_id = t.id AND s.rn = 1
     WHERE t.username = ?1 AND t.is_active = 1`
  )
    .bind(username.toLowerCase())
    .first<TraderSEOData>();

  return row || null;
}

/**
 * Meta tag strings for replacing in base HTML
 */
export interface TraderMetaTags {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  twitterTitle: string;
  twitterDescription: string;
}

/**
 * Generate meta tag replacement strings for a trader profile
 */
export function generateTraderMetaTags(trader: TraderSEOData): TraderMetaTags {
  const roiStr = formatMetric(trader.total_pnl_pct, 1, "%");
  const sharpeStr = trader.sharpe_ratio !== null ? trader.sharpe_ratio.toFixed(2) : "N/A";
  const winRateStr = trader.win_rate !== null ? `${trader.win_rate.toFixed(0)}%` : "N/A";
  const scoreStr = trader.composite_score !== null ? trader.composite_score.toFixed(0) : "NEW";

  const title = `${trader.username} | AI Trading Bot Performance | SUKUNA - MAHORAGA Leaderboard`;
  const description = trader.composite_score !== null
    ? `${trader.username} trading bot: ${roiStr} ROI, ${sharpeStr} Sharpe, ${winRateStr} win rate. Score: ${scoreStr}/100. View live performance on the SUKUNA - MAHORAGA Leaderboard.`
    : `${trader.username} is a new trading bot on the SUKUNA - MAHORAGA Leaderboard. Performance metrics are being calculated.`;
  const url = `https://sukuna.dev/trader/${trader.username}`;

  return {
    title: `<title>${escapeHtml(title)}</title>`,
    description: `<meta name="description" content="${escapeHtml(description)}" />`,
    canonical: `<link rel="canonical" href="${escapeHtml(url)}" />`,
    ogTitle: `<meta property="og:title" content="${escapeHtml(trader.username)} | ${roiStr} ROI | SUKUNA - MAHORAGA Leaderboard" />`,
    ogDescription: `<meta property="og:description" content="${escapeHtml(description)}" />`,
    ogUrl: `<meta property="og:url" content="${escapeHtml(url)}" />`,
    twitterTitle: `<meta name="twitter:title" content="${escapeHtml(trader.username)} | ${roiStr} ROI | SUKUNA - MAHORAGA Leaderboard" />`,
    twitterDescription: `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMetric(value: number | null, decimals = 1, suffix = ""): string {
  if (value === null || value === undefined) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}${suffix}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
