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

/**
 * How long a trader can go without syncing before being considered stale.
 *
 * A "stale" trader is one whose queue message was likely lost — their
 * last_synced_at is far older than their tier's expected sync interval.
 * The cron safety net uses these thresholds to re-enqueue lost traders.
 *
 * Set to ~10x the tier delay for high-priority tiers (quick detection)
 * and ~4x for lower tiers (where longer gaps are normal).
 */
const STALE_THRESHOLDS: Record<SyncTier, number> = {
  1: 600,      // 10 min  (10x tier delay) — top traders recover fast
  2: 1800,     // 30 min  (6x tier delay)
  3: 3600,     // 1 hour  (4x tier delay)
  4: 7200,     // 2 hours (4x tier delay)
  5: 86400,    // 24 hours (4x tier delay)
};

export function tierStaleThresholdSeconds(tier: SyncTier): number {
  return STALE_THRESHOLDS[tier];
}
