/**
 * Proves that Alpaca's `after` parameter is INCLUSIVE (not exclusive as documented).
 *
 * This was the root cause of inflated trade counts: the boundary order was
 * re-returned on every incremental sync, adding +1 to the count each time.
 *
 * Usage:
 *   ALPACA_API_KEY=... ALPACA_API_SECRET=... bun run scripts/test-after-inclusive.ts
 *
 * Expected output:
 *   - `after=submitted_at` returns 1 order (the boundary order itself)
 *   - `after=created_at` returns 1 order (same)
 *   - This proves `after` is inclusive, not exclusive
 *
 * Also tests: Alpaca rejects order IDs in `after`/`until` params (422).
 */

const BASE = "https://paper-api.alpaca.markets";

const apiKey = process.env.ALPACA_API_KEY;
const apiSecret = process.env.ALPACA_API_SECRET;

if (!apiKey || !apiSecret) {
  console.error("Provide ALPACA_API_KEY and ALPACA_API_SECRET");
  process.exit(1);
}

const headers: Record<string, string> = {
  "APCA-API-KEY-ID": apiKey,
  "APCA-API-SECRET-KEY": apiSecret,
};

// Get the newest closed order
const res1 = await fetch(
  `${BASE}/v2/orders?status=closed&limit=1&direction=desc`,
  { headers }
);
if (!res1.ok) {
  console.error(`Failed to fetch orders: ${res1.status}`);
  process.exit(1);
}

const orders = (await res1.json()) as Record<string, unknown>[];
if (orders.length === 0) {
  console.log("No closed orders found. Place some trades first.");
  process.exit(0);
}

const newest = orders[0];
console.log("Newest closed order:");
console.log(`  id:           ${newest.id}`);
console.log(`  symbol:       ${newest.symbol}`);
console.log(`  status:       ${newest.status}`);
console.log(`  submitted_at: ${newest.submitted_at}`);
console.log(`  created_at:   ${newest.created_at}`);

// Test 1: after=submitted_at (should return 0 if exclusive, 1 if inclusive)
const afterTs = newest.submitted_at as string;
console.log(`\n=== Test 1: after=${afterTs} (submitted_at) ===`);
const res2 = await fetch(
  `${BASE}/v2/orders?status=closed&limit=500&direction=asc&after=${afterTs}`,
  { headers }
);
const afterOrders = (await res2.json()) as Record<string, unknown>[];
console.log(`Orders returned: ${afterOrders.length}`);
for (const o of afterOrders) {
  console.log(
    `  ${(o.status as string).padEnd(12)} ${(o.symbol as string).padEnd(8)} submitted=${o.submitted_at}`
  );
}
console.log(
  afterOrders.length > 0
    ? "INCLUSIVE (bug confirmed: boundary order re-returned)"
    : "EXCLUSIVE (as documented)"
);

// Test 2: after=created_at
const afterTs2 = newest.created_at as string;
console.log(`\n=== Test 2: after=${afterTs2} (created_at) ===`);
const res3 = await fetch(
  `${BASE}/v2/orders?status=closed&limit=500&direction=asc&after=${afterTs2}`,
  { headers }
);
const afterOrders2 = (await res3.json()) as Record<string, unknown>[];
console.log(`Orders returned: ${afterOrders2.length}`);
console.log(
  afterOrders2.length > 0
    ? "INCLUSIVE (same behavior with created_at)"
    : "EXCLUSIVE"
);

// Test 3: Alpaca rejects order IDs in after/until params
const orderId = newest.id as string;
console.log(`\n=== Test 3: after=<order_id> (${orderId}) ===`);
const res4 = await fetch(
  `${BASE}/v2/orders?status=closed&limit=500&direction=asc&after=${orderId}`,
  { headers }
);
console.log(`Status: ${res4.status}`);
if (!res4.ok) {
  console.log("Rejected (as expected: Alpaca only accepts timestamps, not IDs)");
} else {
  const data = (await res4.json()) as unknown[];
  console.log(`Unexpectedly accepted, returned ${data.length} orders`);
}

console.log("\n=== Summary ===");
console.log(
  "Alpaca's `after` param is inclusive at the boundary. The fix skips the"
);
console.log(
  "anchor order by ID. If `after` behavior ever changes, the syncer falls"
);
console.log("back to a full recount automatically.");
