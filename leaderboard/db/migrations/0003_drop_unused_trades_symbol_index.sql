-- Drop unused index on trades(symbol)
--
-- This index was created speculatively but is never used by any query.
-- All trades queries filter by trader_id and sort by filled_at, which are
-- covered by idx_trades_trader. The symbol grouping happens in JavaScript
-- after data is fetched, not in SQL.

DROP INDEX IF EXISTS idx_trades_symbol;
