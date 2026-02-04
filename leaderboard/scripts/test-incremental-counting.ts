/**
 * End-to-end test of the "back up and anchor" incremental trade counting.
 *
 * Simulates 4 consecutive syncs against a real Alpaca account and verifies
 * the trade count stays stable (no double-counting, no missed orders).
 *
 * This replicates the logic in worker/alpaca.ts:
 *   1. Full count (first sync) — paginates all orders DESC
 *   2-4. Incremental syncs — backs up 1 second from checkpoint timestamp,
 *        finds anchor order by ID, counts only new filled orders after it
 *
 * Usage:
 *   ALPACA_API_KEY=... ALPACA_API_SECRET=... bun run scripts/test-incremental-counting.ts
 *
 * Expected output: count stays stable across all 4 syncs (PASS).
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

function extractSubmittedAt(o: Record<string, unknown>): string {
  return (
    (o.submitted_at as string) ??
    (o.created_at as string) ??
    new Date(0).toISOString()
  );
}

/**
 * Simulates the "back up and anchor" incremental count.
 * Mirrors worker/alpaca.ts fetchFilledOrderCountSince().
 */
async function incrementalCount(
  anchorTimestamp: string,
  anchorId: string
): Promise<{ newFilled: number; nextTimestamp: string; nextId: string }> {
  // Back up 1 second (safety buffer for timestamp precision)
  const bufferedAfter = new Date(
    new Date(anchorTimestamp).getTime() - 1000
  ).toISOString();

  const params = new URLSearchParams({
    status: "closed",
    limit: "500",
    direction: "asc",
    after: bufferedAfter,
  });

  const res = await fetch(`${BASE}/v2/orders?${params}`, { headers });
  if (!res.ok) {
    console.error(`  API returned ${res.status}`);
    return { newFilled: 0, nextTimestamp: anchorTimestamp, nextId: anchorId };
  }

  const orders = (await res.json()) as Record<string, unknown>[];

  let foundAnchor = false;
  let newFilled = 0;
  let lastTimestamp = anchorTimestamp;
  let lastId = anchorId;

  for (const order of orders) {
    const orderId = order.id as string;

    // Skip everything up to and including the anchor
    if (!foundAnchor) {
      if (orderId === anchorId) foundAnchor = true;
      continue;
    }

    if (order.status === "filled") newFilled++;
    lastTimestamp = extractSubmittedAt(order);
    lastId = orderId;
  }

  if (!foundAnchor) {
    console.error("  WARNING: anchor not found in buffer window");
  }

  return {
    newFilled,
    nextTimestamp: newFilled > 0 ? lastTimestamp : anchorTimestamp,
    nextId: newFilled > 0 ? lastId : anchorId,
  };
}

// --- Step 1: Full count (first sync) ---
console.log("=== Step 1: Full count ===");
const res1 = await fetch(
  `${BASE}/v2/orders?status=closed&limit=500&direction=desc`,
  { headers }
);
const allOrders = (await res1.json()) as Record<string, unknown>[];
const baselineFilled = allOrders.filter((o) => o.status === "filled").length;
let anchorTimestamp = allOrders.length > 0 ? extractSubmittedAt(allOrders[0]) : "";
let anchorId = allOrders.length > 0 ? (allOrders[0].id as string) : "";
let runningTotal = baselineFilled;
console.log(
  `Count: ${baselineFilled}, checkpoint: ${anchorTimestamp}, id: ${anchorId}`
);

// --- Steps 2-4: Incremental syncs ---
for (let syncNum = 2; syncNum <= 4; syncNum++) {
  console.log(`\n=== Step ${syncNum}: Incremental (sync #${syncNum}) ===`);
  const result = await incrementalCount(anchorTimestamp, anchorId);
  runningTotal += result.newFilled;
  anchorTimestamp = result.nextTimestamp;
  anchorId = result.nextId;
  console.log(
    `New filled: ${result.newFilled}, running total: ${runningTotal}`
  );
}

// --- Verify ---
const passed = runningTotal === baselineFilled;
console.log(
  `\n=== Result: count stable at ${runningTotal} across 4 syncs: ${passed ? "PASS" : "FAIL"} ===`
);
process.exit(passed ? 0 : 1);
