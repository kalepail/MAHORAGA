-- Add columns for incremental trade counting
--
-- Instead of paginating through ALL orders on every sync to count trades,
-- we store a running total and only count new orders since the last sync.
--
-- lifetime_trade_count: Running total of filled orders (all-time)
-- last_count_order_created_at: created_at of the newest order at time of last count
--                              Used as the 'after' parameter for incremental fetches

ALTER TABLE traders ADD COLUMN lifetime_trade_count INTEGER;
ALTER TABLE traders ADD COLUMN last_count_order_created_at TEXT;
