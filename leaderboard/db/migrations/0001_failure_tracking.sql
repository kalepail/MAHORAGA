-- Add failure tracking columns for auto-deactivation and purge
--
-- first_failure_at: When the failure streak started. Starts the 7-day grace period.
--                   Reset to NULL on successful sync (auto-recovery).
--
-- last_failure_reason: Debug info for why the account is failing.
--                      Reset to NULL on successful sync.
--
-- After 7 days from first_failure_at without a successful sync,
-- the account and all associated data are permanently deleted.

ALTER TABLE traders ADD COLUMN first_failure_at TEXT;
ALTER TABLE traders ADD COLUMN last_failure_reason TEXT;
