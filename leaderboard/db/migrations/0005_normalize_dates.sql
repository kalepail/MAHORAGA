-- Migration: Normalize datetime columns from SQLite format to ISO 8601.
--
-- Converts "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS.000Z"
-- Idempotent: only updates rows that don't already contain 'T'.
--
-- Columns migrated:
--   traders.joined_at
--   traders.last_synced_at
--   traders.first_failure_at
--   oauth_tokens.connected_at
--   oauth_tokens.last_used_at
--
-- NOT migrated (already ISO or different semantic):
--   last_trade_at            — already ISO from Alpaca
--   equity_history.timestamp — already ISO from JS toISOString()
--   trades.filled_at         — already ISO from Alpaca
--   snapshot_date            — date-only (YYYY-MM-DD)
--   last_count_order_submitted_at — Alpaca API cursor

UPDATE traders
SET joined_at = replace(joined_at, ' ', 'T') || '.000Z'
WHERE joined_at IS NOT NULL AND joined_at NOT LIKE '%T%';

UPDATE traders
SET last_synced_at = replace(last_synced_at, ' ', 'T') || '.000Z'
WHERE last_synced_at IS NOT NULL AND last_synced_at NOT LIKE '%T%';

UPDATE traders
SET first_failure_at = replace(first_failure_at, ' ', 'T') || '.000Z'
WHERE first_failure_at IS NOT NULL AND first_failure_at NOT LIKE '%T%';

UPDATE oauth_tokens
SET connected_at = replace(connected_at, ' ', 'T') || '.000Z'
WHERE connected_at IS NOT NULL AND connected_at NOT LIKE '%T%';

UPDATE oauth_tokens
SET last_used_at = replace(last_used_at, ' ', 'T') || '.000Z'
WHERE last_used_at IS NOT NULL AND last_used_at NOT LIKE '%T%';
