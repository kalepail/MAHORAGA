/**
 * Sync tier definitions for queue-based adaptive sync.
 *
 * Each trader is assigned a tier based on their composite score rank
 * and recent trading activity. The tier determines how frequently
 * their data is synced from Alpaca.
 */

export type SyncTier = 1 | 2 | 3 | 4 | 5;

/** Delay in seconds between syncs for each tier. */
const TIER_DELAYS: Record<SyncTier, number> = {
  1: 60,       // 1 min  — Top 100 by composite score
  2: 300,      // 5 min  — Rank 101–500
  3: 900,      // 15 min — Rank 501–2000 OR trades in last 48h
  4: 1800,     // 30 min — Active (trades in last 7d)
  5: 21600,    // 6 hours — Dormant (no trades 30d+)
};

export function tierDelaySeconds(tier: SyncTier): number {
  return TIER_DELAYS[tier];
}
