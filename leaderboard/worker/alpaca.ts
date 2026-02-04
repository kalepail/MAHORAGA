/**
 * Alpaca Paper Trading API client.
 *
 * All calls hit paper-api.alpaca.markets exclusively.
 * All monetary fields in Alpaca responses are STRINGS (except portfolio history).
 * This module parses them into numbers.
 */

const BASE = "https://paper-api.alpaca.markets";

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Types (matching Alpaca response shapes)
// ---------------------------------------------------------------------------

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  equity: number;
  last_equity: number;
  cash: number;
  buying_power: number;
  long_market_value: number;
  short_market_value: number;
  portfolio_value: number;
  pattern_day_trader: boolean;
  daytrade_count: number;
  created_at: string;
}

export interface AlpacaPosition {
  symbol: string;
  asset_class: string; // "us_equity" or "crypto"
  qty: number;
  side: string;
  avg_entry_price: number;
  market_value: number;
  cost_basis: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  unrealized_intraday_pl: number;
  current_price: number;
  lastday_price: number;
  change_today: number;
}

export interface AlpacaPortfolioHistory {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
  base_value: number;
  timeframe: string;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  asset_class: string;
  qty: number | null;
  filled_qty: number;
  filled_avg_price: number | null;
  side: string;
  type: string;
  status: string;
  filled_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function fetchAccount(token: string): Promise<AlpacaAccount> {
  const res = await fetch(`${BASE}/v2/account`, { headers: headers(token) });
  if (!res.ok) throw new AlpacaError("account", res.status, await res.text());
  const raw = (await res.json()) as Record<string, unknown>;
  return {
    id: raw.id as string,
    account_number: raw.account_number as string,
    status: raw.status as string,
    equity: parseFloat(raw.equity as string),
    last_equity: parseFloat(raw.last_equity as string),
    cash: parseFloat(raw.cash as string),
    buying_power: parseFloat(raw.buying_power as string),
    long_market_value: parseFloat(raw.long_market_value as string),
    short_market_value: parseFloat(raw.short_market_value as string),
    portfolio_value: parseFloat(raw.portfolio_value as string),
    pattern_day_trader: raw.pattern_day_trader as boolean,
    daytrade_count: raw.daytrade_count as number,
    created_at: raw.created_at as string,
  };
}

export async function fetchPositions(
  token: string
): Promise<AlpacaPosition[]> {
  const res = await fetch(`${BASE}/v2/positions`, { headers: headers(token) });
  if (!res.ok)
    throw new AlpacaError("positions", res.status, await res.text());
  const raw = (await res.json()) as Record<string, unknown>[];
  return raw.map((p) => ({
    symbol: p.symbol as string,
    asset_class: p.asset_class as string,
    qty: parseFloat(p.qty as string),
    side: p.side as string,
    avg_entry_price: parseFloat(p.avg_entry_price as string),
    market_value: parseFloat(p.market_value as string),
    cost_basis: parseFloat(p.cost_basis as string),
    unrealized_pl: parseFloat(p.unrealized_pl as string),
    unrealized_plpc: parseFloat(p.unrealized_plpc as string),
    unrealized_intraday_pl: parseFloat(p.unrealized_intraday_pl as string),
    current_price: parseFloat(p.current_price as string),
    lastday_price: parseFloat(p.lastday_price as string),
    change_today: parseFloat(p.change_today as string),
  }));
}

/**
 * Fetch daily portfolio history. Returns parallel arrays of timestamps, equity,
 * profit_loss, and profit_loss_pct. These are already numbers (exception to the
 * strings-everywhere pattern).
 *
 * Key field: `base_value` — the account equity at the start of the requested
 * period. With period=all, this is the initial account funding (whatever
 * the paper account was seeded with). The syncer uses this as the cost
 * basis for P&L calculations when no explicit CSD deposits exist.
 */
export async function fetchPortfolioHistory(
  token: string,
  opts: { period?: string; timeframe?: string; dateStart?: string; dateEnd?: string } = {}
): Promise<AlpacaPortfolioHistory> {
  const params = new URLSearchParams({ timeframe: opts.timeframe || "1D" });
  if (opts.period) params.set("period", opts.period);
  if (opts.dateStart) params.set("date_start", opts.dateStart);
  if (opts.dateEnd) params.set("date_end", opts.dateEnd);

  const res = await fetch(
    `${BASE}/v2/account/portfolio/history?${params}`,
    { headers: headers(token) }
  );
  if (!res.ok)
    throw new AlpacaError("portfolio_history", res.status, await res.text());

  const raw = (await res.json()) as AlpacaPortfolioHistory;

  // Normalize timestamps: Alpaca may return seconds or milliseconds.
  // If the first timestamp is less than 1e12, it is seconds.
  if (raw.timestamp.length > 0 && raw.timestamp[0] < 1e12) {
    raw.timestamp = raw.timestamp.map((t) => t * 1000);
  }

  return raw;
}

/**
 * Fetch all cash deposits (CSD activities) with pagination.
 * Returns the total deposited amount.
 *
 * For standard Alpaca paper accounts:
 *   - The initial seed (any amount from $1 to $1M) is NOT recorded as a CSD activity.
 *   - This function returns $0 for accounts with no explicit deposits.
 *   - The syncer handles this by falling back to portfolio history base_value.
 *
 * For Broker API sandbox accounts:
 *   - Simulated transfers DO appear as CSD activities.
 *   - This function would return the actual deposit total.
 *
 * Users cannot programmatically add funds to a standard paper account.
 * To "reset" they must delete and recreate via the Alpaca dashboard,
 * which generates a new account ID and new API keys.
 */
export async function fetchTotalDeposits(token: string): Promise<number> {
  let total = 0;
  let pageToken: string | null = null;

  for (;;) {
    const params = new URLSearchParams({ page_size: "100" });
    if (pageToken) params.set("page_token", pageToken);

    const res = await fetch(
      `${BASE}/v2/account/activities/CSD?${params}`,
      { headers: headers(token) }
    );

    if (!res.ok) {
      // If no deposits exist, Alpaca may return 404 or empty
      if (res.status === 404) break;
      throw new AlpacaError("deposits", res.status, await res.text());
    }

    const activities = (await res.json()) as Record<string, unknown>[];
    if (activities.length === 0) break;

    for (const a of activities) {
      total += parseFloat(a.net_amount as string);
    }

    // If we got fewer than page_size, we're done
    if (activities.length < 100) break;

    // Use the last activity's id as page_token
    pageToken = activities[activities.length - 1].id as string;
  }

  return total;
}

/**
 * Fetch recent closed orders. Returns up to `limit` orders (max 500 per call).
 * For the leaderboard we only need recent trades for display, not the full history.
 */
export async function fetchClosedOrders(
  token: string,
  limit = 100
): Promise<AlpacaOrder[]> {
  const params = new URLSearchParams({
    status: "closed",
    limit: String(Math.min(limit, 500)),
    direction: "desc",
  });

  const res = await fetch(`${BASE}/v2/orders?${params}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new AlpacaError("orders", res.status, await res.text());

  const raw = (await res.json()) as Record<string, unknown>[];
  return raw
    .filter((o) => o.status === "filled" && o.filled_at)
    .map((o) => ({
      id: o.id as string,
      symbol: o.symbol as string,
      asset_class: o.asset_class as string,
      qty: o.qty ? parseFloat(o.qty as string) : null,
      filled_qty: parseFloat(o.filled_qty as string),
      filled_avg_price: o.filled_avg_price
        ? parseFloat(o.filled_avg_price as string)
        : null,
      side: o.side as string,
      type: o.type as string,
      status: o.status as string,
      filled_at: o.filled_at as string,
      created_at: o.created_at as string,
    }));
}

/** Result of a full trade count operation. */
export interface FullTradeCountResult {
  count: number;
  /** submitted_at of the newest order, used for subsequent incremental counts. */
  newestOrderSubmittedAt: string | null;
  /** ID of the newest order, used to skip it in subsequent incremental counts. */
  newestOrderId: string | null;
}

/**
 * Fetch total number of closed (filled) orders. Paginates through ALL orders.
 *
 * Returns both the count and the newest order's submitted_at timestamp,
 * which can be used for subsequent incremental counting.
 *
 * WARNING: This can make many API calls for accounts with thousands of trades.
 * Use fetchFilledOrderCountSince() for incremental counting when possible.
 */
export async function fetchTotalFilledOrderCount(
  token: string
): Promise<FullTradeCountResult> {
  let total = 0;
  let until: string | null = null;
  let newestOrderSubmittedAt: string | null = null;
  let newestOrderId: string | null = null;

  for (;;) {
    const params = new URLSearchParams({
      status: "closed",
      limit: "500",
      direction: "desc",
    });
    if (until) params.set("until", until);

    const res = await fetch(`${BASE}/v2/orders?${params}`, {
      headers: headers(token),
    });
    if (!res.ok) {
      console.error(`[alpaca] fetchTotalFilledOrderCount: orders endpoint returned ${res.status} mid-pagination (counted ${total} so far)`);
      break;
    }

    const orders = (await res.json()) as Record<string, unknown>[];
    if (orders.length === 0) break;

    // On first page, capture the newest order's submitted_at and ID
    if (newestOrderSubmittedAt === null && orders.length > 0) {
      newestOrderSubmittedAt = extractOrderSubmittedAt(orders[0]);
      newestOrderId = orders[0].id as string;
    }

    const filled = orders.filter((o) => o.status === "filled");
    total += filled.length;

    if (orders.length < 500) break;

    // Use the oldest order's submitted_at as the `until` for the next page
    until = extractOrderSubmittedAt(orders[orders.length - 1]);
  }

  return { count: total, newestOrderSubmittedAt, newestOrderId };
}

/** Result of an incremental trade count operation. */
export interface IncrementalTradeCountResult {
  /** Number of new filled orders since the anchor. */
  newCount: number;
  /** submitted_at of the last order we processed. Use this as the next 'after' value. */
  lastProcessedOrderSubmittedAt: string | null;
  /** ID of the last order we processed. Used as the anchor in the next incremental call. */
  lastProcessedOrderId: string | null;
  /** True if we hit the page limit. Count is still accurate for orders processed. */
  hitPageLimit: boolean;
}

/**
 * Fetch count of filled orders submitted after a known anchor order.
 *
 * Used for incremental trade counting: instead of paginating through ALL orders
 * every sync, we store a running total and only count new orders since last sync.
 *
 * Strategy — "back up and anchor":
 *   1. Subtract 1 second from the stored timestamp to create a safety buffer.
 *      This ensures we never miss orders due to Alpaca's sub-millisecond
 *      timestamp precision issues or `after` param quirks.
 *   2. Fetch orders from that buffered start point (ASC, oldest → newest).
 *   3. Scan forward until we find the anchor order (by ID). Everything before
 *      and including the anchor was already counted — skip it.
 *   4. Count filled orders that come AFTER the anchor. These are genuinely new.
 *
 * This is fully deterministic: the order ID is the source of truth, not
 * timestamps. No precision issues, no double-counting, no missed orders.
 *
 * @param token - Alpaca access token
 * @param afterTimestamp - submitted_at of the last counted order (we subtract 1s for buffer)
 * @param anchorOrderId - ID of the last counted order (our dedup anchor point)
 * @param maxPages - Safety limit on pagination (default 10 = 5000 orders max)
 */
export async function fetchFilledOrderCountSince(
  token: string,
  afterTimestamp: string,
  anchorOrderId: string,
  maxPages = 10
): Promise<IncrementalTradeCountResult> {
  // Back up by 1 second so timestamp precision issues can never cause us
  // to miss orders. The anchor ID is the real boundary, not the timestamp.
  const bufferedAfter = new Date(
    new Date(afterTimestamp).getTime() - 1000
  ).toISOString();

  let newCount = 0;
  let lastProcessedOrderSubmittedAt: string | null = null;
  let lastProcessedOrderId: string | null = null;
  let foundAnchor = false;
  let currentAfter = bufferedAfter;
  let prevPageLastId: string | null = null; // for page-boundary dedup
  let pageCount = 0;

  for (; pageCount < maxPages; pageCount++) {
    const params = new URLSearchParams({
      status: "closed",
      limit: "500",
      direction: "asc",
      after: currentAfter,
    });

    const res = await fetch(`${BASE}/v2/orders?${params}`, {
      headers: headers(token),
    });
    if (!res.ok) {
      console.error(`[alpaca] fetchFilledOrderCountSince: orders endpoint returned ${res.status} mid-pagination (counted ${newCount} so far)`);
      break;
    }

    const orders = (await res.json()) as Record<string, unknown>[];
    if (orders.length === 0) break;

    for (const order of orders) {
      const orderId = order.id as string;

      // Skip orders up to and including the anchor (already counted)
      if (!foundAnchor) {
        if (orderId === anchorOrderId) foundAnchor = true;
        continue;
      }

      // Skip page-boundary order (Alpaca's `after` may re-include it)
      if (orderId === prevPageLastId) continue;

      // This is a genuinely new order
      if (order.status === "filled") newCount++;
      lastProcessedOrderSubmittedAt = extractOrderSubmittedAt(order);
      lastProcessedOrderId = orderId;
    }

    if (orders.length < 500) break;

    // Advance to next page; track last order for boundary dedup
    const lastOrder = orders[orders.length - 1];
    prevPageLastId = lastOrder.id as string;
    currentAfter = extractOrderSubmittedAt(lastOrder);
  }

  if (!foundAnchor) {
    // Anchor order not found in the buffer window. This should be extremely
    // rare (would require the order to vanish or >5000 orders in 1 second).
    // Return 0 new orders so the count doesn't inflate. The next full recount
    // (triggered by cron or manual reset) will correct it.
    console.error(`[alpaca] fetchFilledOrderCountSince: anchor order ${anchorOrderId} not found in buffer window, returning 0 new`);
    return {
      newCount: 0,
      lastProcessedOrderSubmittedAt: null,
      lastProcessedOrderId: null,
      hitPageLimit: false,
    };
  }

  return {
    newCount,
    lastProcessedOrderSubmittedAt,
    lastProcessedOrderId,
    hitPageLimit: pageCount >= maxPages,
  };
}

function extractOrderSubmittedAt(order: Record<string, unknown>): string {
  const submitted = order.submitted_at as string | undefined;
  const created = order.created_at as string | undefined;
  return submitted ?? created ?? new Date(0).toISOString();
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Sanitize error response body to remove any potentially sensitive info. */
function sanitizeErrorBody(body: string): string {
  // Truncate to reasonable length and strip common patterns that might leak info
  let sanitized = body.slice(0, 200);
  // Remove any JSON keys that could contain sensitive data
  sanitized = sanitized.replace(/"(access_token|api_key|secret|password|token)":\s*"[^"]*"/gi, '"$1":"[REDACTED]"');
  return sanitized;
}

export class AlpacaError extends Error {
  /** Sanitized error body (safe for logging). */
  public sanitizedBody: string;

  constructor(
    public endpoint: string,
    public status: number,
    body: string
  ) {
    const sanitized = sanitizeErrorBody(body);
    super(`Alpaca ${endpoint} failed (${status}): ${sanitized}`);
    this.sanitizedBody = sanitized;
  }
}
