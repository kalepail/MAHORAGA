/**
 * Verify Alpaca filled order count against the leaderboard's counting logic.
 *
 * Usage (API key auth):
 *   ALPACA_API_KEY=... ALPACA_API_SECRET=... bun run scripts/verify-trade-count.ts
 *
 * Usage (OAuth bearer token):
 *   ALPACA_BEARER_TOKEN=... bun run scripts/verify-trade-count.ts
 *
 * This replicates the exact logic from worker/alpaca.ts
 * (fetchTotalFilledOrderCount) so you can compare the result
 * against the lifetime_trade_count stored in D1.
 */

const BASE = "https://paper-api.alpaca.markets";

// ---------------------------------------------------------------------------
// Auth — supports both API key and OAuth bearer token
// ---------------------------------------------------------------------------

const bearerToken = process.env.ALPACA_BEARER_TOKEN;
const apiKey = process.env.ALPACA_API_KEY;
const apiSecret = process.env.ALPACA_API_SECRET;

if (!bearerToken && (!apiKey || !apiSecret)) {
  console.error(
    "Provide either ALPACA_BEARER_TOKEN or both ALPACA_API_KEY + ALPACA_API_SECRET"
  );
  process.exit(1);
}

const authHeaders: Record<string, string> = bearerToken
  ? { Authorization: `Bearer ${bearerToken}` }
  : { "APCA-API-KEY-ID": apiKey!, "APCA-API-SECRET-KEY": apiSecret! };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlpacaOrder {
  id: string;
  symbol: string;
  asset_class: string;
  qty: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  side: string;
  type: string;
  status: string;
  filled_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Replicate fetchTotalFilledOrderCount from worker/alpaca.ts
// ---------------------------------------------------------------------------

async function countAllFilledOrders() {
  let total = 0;
  let totalClosed = 0;
  let until: string | null = null;
  let newestOrderCreatedAt: string | null = null;
  let oldestOrderCreatedAt: string | null = null;
  let pageNum = 0;
  const statusBreakdown: Record<string, number> = {};

  for (;;) {
    pageNum++;
    const params = new URLSearchParams({
      status: "closed",
      limit: "500",
      direction: "desc",
    });
    if (until) params.set("until", until);

    const res = await fetch(`${BASE}/v2/orders?${params}`, {
      headers: authHeaders,
    });
    if (!res.ok) {
      console.error(`  Page ${pageNum}: API returned ${res.status}`);
      break;
    }

    const orders = (await res.json()) as AlpacaOrder[];
    if (orders.length === 0) break;

    totalClosed += orders.length;

    if (newestOrderCreatedAt === null) {
      newestOrderCreatedAt = orders[0].created_at;
    }
    oldestOrderCreatedAt = orders[orders.length - 1].created_at;

    for (const o of orders) {
      statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1;
    }

    const filled = orders.filter((o) => o.status === "filled");
    total += filled.length;

    console.log(
      `  Page ${pageNum}: ${orders.length} closed, ${filled.length} filled  (running total: ${total})`
    );

    if (orders.length < 500) break;
    until = orders[orders.length - 1].created_at;
  }

  return {
    total,
    totalClosed,
    newestOrderCreatedAt,
    oldestOrderCreatedAt,
    pageNum,
    statusBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Fetch account info
// ---------------------------------------------------------------------------

async function getAccount() {
  const res = await fetch(`${BASE}/v2/account`, { headers: authHeaders });
  if (!res.ok) {
    console.error("Account fetch failed:", res.status);
    return null;
  }
  const acct = (await res.json()) as Record<string, unknown>;
  return {
    id: acct.id as string,
    equity: acct.equity as string,
    status: acct.status as string,
    created_at: acct.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== Verify Alpaca Filled Order Count ===\n");
console.log(`Auth method: ${bearerToken ? "OAuth Bearer" : "API Key"}\n`);

const [account, countResult] = await Promise.all([
  getAccount(),
  countAllFilledOrders(),
]);

console.log("\n--- Account ---");
if (account) {
  console.log(`  ID:         ${account.id}`);
  console.log(`  Equity:     $${account.equity}`);
  console.log(`  Status:     ${account.status}`);
  console.log(`  Created at: ${account.created_at}`);
} else {
  console.log("  (failed to fetch)");
}

console.log("\n--- Counting Result ---");
console.log(
  `  Filled orders (num_trades on leaderboard): ${countResult.total}`
);
console.log(
  `  Total closed orders (all statuses):        ${countResult.totalClosed}`
);
console.log(
  `  Pages fetched:                             ${countResult.pageNum}`
);
console.log(
  `  Newest order: ${countResult.newestOrderCreatedAt ?? "(none)"}`
);
console.log(
  `  Oldest order: ${countResult.oldestOrderCreatedAt ?? "(none)"}`
);

console.log("\n--- Status Breakdown (all closed orders) ---");
for (const [status, count] of Object.entries(
  countResult.statusBreakdown
).sort((a, b) => (b[1] as number) - (a[1] as number))) {
  const pct = ((count / countResult.totalClosed) * 100).toFixed(1);
  console.log(
    `  ${status.padEnd(18)} ${String(count).padStart(6)}  (${pct}%)`
  );
}

if (account) {
  console.log(
    `\nCompare the filled count (${countResult.total}) with the lifetime_trade_count`
  );
  console.log(
    `stored in D1 for Alpaca account ${account.id}.`
  );
  console.log(
    `\nTo check D1:  npx wrangler d1 execute mahoraga-leaderboard-db --remote \\`
  );
  console.log(
    `  --command "SELECT username, lifetime_trade_count FROM traders t JOIN oauth_tokens ot ON ot.trader_id = t.id WHERE ot.alpaca_account_id = '${account.id}'"`
  );
}
