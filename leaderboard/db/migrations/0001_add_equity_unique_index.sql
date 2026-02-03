-- Add UNIQUE constraint on equity_history(trader_id, timestamp)
--
-- The equity_history table stores daily equity curve data from Alpaca.
-- Each (trader_id, timestamp) pair should be unique - one data point per day per trader.
-- The syncer already uses DELETE + INSERT which prevents duplicates, but this adds
-- database-level integrity as a safety net.
--
-- First, clean up any existing duplicates (keep one arbitrary row per pair).
-- This handles the case where duplicates somehow exist before the constraint is added.

DELETE FROM equity_history
WHERE id NOT IN (
  SELECT MIN(id) FROM equity_history GROUP BY trader_id, timestamp
);

-- Create the unique index. This is equivalent to a UNIQUE constraint but can be
-- added/dropped more easily. The existing idx_equity_trader index is kept for
-- query performance (it has DESC ordering for sparklines).
CREATE UNIQUE INDEX IF NOT EXISTS idx_equity_unique_trader_timestamp
  ON equity_history(trader_id, timestamp);
