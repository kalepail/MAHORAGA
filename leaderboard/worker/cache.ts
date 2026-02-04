/**
 * KV caching layer for leaderboard reads.
 *
 * Strategy:
 * - Leaderboard first page cached for 15 min (read-through + cron pre-warms default view)
 * - Stats cached for 15 min (read-through + cron pre-warms)
 * - Trader profiles/trades/equity cached for 5 min (read-through, invalidated after sync)
 *
 * Cache key patterns:
 * - leaderboard:{sort}:{sortDir}:{minTrades}
 * - leaderboard:stats
 * - trader:{username}:profile
 * - trader:{username}:trades:{limit}:{offset} (offset always 0, kept for API compatibility)
 * - trader:{username}:equity:{days}
 */

const LEADERBOARD_TTL = 900;   // 15 minutes
const TRADER_TTL = 300;        // 5 minutes
const STATS_TTL = 900;         // 15 minutes

// ---------------------------------------------------------------------------
// Leaderboard cache
// ---------------------------------------------------------------------------

export async function getCachedLeaderboard(
  env: Env,
  key: string
): Promise<string | null> {
  return env.KV.get(key, "text");
}

export async function setCachedLeaderboard(
  env: Env,
  key: string,
  data: unknown
): Promise<void> {
  await env.KV.put(key, JSON.stringify(data), { expirationTtl: LEADERBOARD_TTL });
}

// ---------------------------------------------------------------------------
// Stats cache
// ---------------------------------------------------------------------------

export async function getCachedStats(env: Env): Promise<string | null> {
  return env.KV.get("leaderboard:stats", "text");
}

export async function setCachedStats(env: Env, data: unknown): Promise<void> {
  await env.KV.put("leaderboard:stats", JSON.stringify(data), {
    expirationTtl: STATS_TTL,
  });
}

// ---------------------------------------------------------------------------
// Trader profile cache
// ---------------------------------------------------------------------------

export async function getCachedTraderProfile(
  env: Env,
  username: string
): Promise<string | null> {
  return env.KV.get(`trader:${username}:profile`, "text");
}

export async function setCachedTraderProfile(
  env: Env,
  username: string,
  data: unknown
): Promise<void> {
  await env.KV.put(`trader:${username}:profile`, JSON.stringify(data), {
    expirationTtl: TRADER_TTL,
  });
}

// ---------------------------------------------------------------------------
// Trader trades cache
// ---------------------------------------------------------------------------

export async function getCachedTraderTrades(
  env: Env,
  username: string,
  limit: number,
  offset: number
): Promise<string | null> {
  return env.KV.get(`trader:${username}:trades:${limit}:${offset}`, "text");
}

export async function setCachedTraderTrades(
  env: Env,
  username: string,
  limit: number,
  offset: number,
  data: unknown
): Promise<void> {
  await env.KV.put(
    `trader:${username}:trades:${limit}:${offset}`,
    JSON.stringify(data),
    { expirationTtl: TRADER_TTL }
  );
}

// ---------------------------------------------------------------------------
// Trader equity cache
// ---------------------------------------------------------------------------

export async function getCachedTraderEquity(
  env: Env,
  username: string,
  days: number
): Promise<string | null> {
  return env.KV.get(`trader:${username}:equity:${days}`, "text");
}

export async function setCachedTraderEquity(
  env: Env,
  username: string,
  days: number,
  data: unknown
): Promise<void> {
  await env.KV.put(
    `trader:${username}:equity:${days}`,
    JSON.stringify(data),
    { expirationTtl: TRADER_TTL }
  );
}

// ---------------------------------------------------------------------------
// Cache key generation
// ---------------------------------------------------------------------------

export function leaderboardCacheKey(
  sort: string,
  sortDir: string,
  minTrades: number
): string {
  return `leaderboard:${sort}:${sortDir}:${minTrades}`;
}

// ---------------------------------------------------------------------------
// Cache invalidation strategy
// ---------------------------------------------------------------------------
// All KV entries use TTLs (15 min for leaderboard, 5 min for trader data).
// Stale entries expire naturally — no manual list+delete needed.
// The cron pre-warm overwrites the default leaderboard key with fresh data.
// Read-through caching overwrites keys on cache miss.

