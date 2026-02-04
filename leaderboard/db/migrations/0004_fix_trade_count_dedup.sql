-- Fix inflated trade counts caused by Alpaca's `after` parameter being
-- inclusive (returning the boundary order on every sync).
--
-- Changes:
--   1. Rename last_count_order_created_at → last_count_order_submitted_at
--      (submitted_at is more reliable for ordering than created_at)
--   2. Add last_count_order_id for deterministic ID-based deduplication
--   3. Reset all counting state to trigger a fresh full recount

ALTER TABLE traders RENAME COLUMN last_count_order_created_at TO last_count_order_submitted_at;

ALTER TABLE traders ADD COLUMN last_count_order_id TEXT;

UPDATE traders
SET lifetime_trade_count = NULL,
    last_count_order_submitted_at = NULL,
    last_count_order_id = NULL;

UPDATE performance_snapshots
SET num_trades = 0;
