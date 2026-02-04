-- Migration 0006: Optimize indexes
--
-- 1. Drop unused idx_snapshots_date (no query uses snapshot_date without trader_id)
-- 2. Replace idx_equity_trader with covering index (adds equity column to avoid table lookups for sparklines)
-- 3. Replace idx_traders_stale_sync with composite partial index for reEnqueueStaleTraders cron query

-- Priority 1: Remove unused index (saves write overhead on every snapshot insert)
DROP INDEX IF EXISTS idx_snapshots_date;

-- Priority 2: Covering index for sparklines
-- Old: idx_equity_trader(trader_id, timestamp DESC)
-- New: idx_equity_trader(trader_id, timestamp DESC, equity)
-- Adding equity to the index lets sparkline queries (SELECT equity WHERE trader_id ORDER BY timestamp DESC LIMIT 30)
-- be satisfied entirely from the index without table lookups.
DROP INDEX IF EXISTS idx_equity_trader;
CREATE INDEX IF NOT EXISTS idx_equity_trader ON equity_history(trader_id, timestamp DESC, equity);

-- Priority 3: Better partial index for stale re-enqueue
-- Old: idx_traders_stale_sync(last_synced_at) WHERE is_active = 1
-- New: idx_traders_active_tier_sync(sync_tier, last_synced_at) WHERE is_active = 1
-- Covers the compound sync_tier + last_synced_at filter and ORDER BY sync_tier in reEnqueueStaleTraders.
DROP INDEX IF EXISTS idx_traders_stale_sync;
CREATE INDEX IF NOT EXISTS idx_traders_active_tier_sync ON traders(sync_tier, last_synced_at) WHERE is_active = 1;
