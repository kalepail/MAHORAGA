# MAHORAGA Root Source Audit (Complementary)

**Date:** 2026-02-04
**Branch:** `feat/aggressive-100-position-config`
**Scope:** Core Cloudflare Worker at repo root (`src/**`, `wrangler.jsonc`, `migrations/**`). Excludes `dashboard/` and `leaderboard/`.

This audit is intentionally complementary to `audits/storage-and-cron-audit.md` and avoids repeating KV/R2/cron or DO storage findings already covered there.

---

## Summary (Top Findings)

1. **Position research never runs** because `lastResearchRun` is updated by top-signal research every 120s, so the 300s "position research" gate never opens. (High)
2. **Risk state is never updated** in normal flows: `recordDailyLoss()` and `setCooldown()` are defined but never called, so daily loss and cooldown checks are effectively inert. (High)
3. **Kill switch is split-brain**: MCP kill switch toggles D1 only, while the autonomous harness ignores D1 risk state; `/agent/kill` stops the DO but does not set the D1 kill switch. (High)
4. **Approval token ID mismatch**: token uses a generated ID that isn't the stored approval row ID, breaking traceability and consistency. (Medium)
5. **Trade records are wrong for notional orders**: `notional` is stored in the `qty` column and trade status never updates. (Medium)

---

## Findings

### High

**1) Position research loop never executes**
- **What:** `lastResearchRun` is set after `researchTopSignals()` (120s cadence), but the same value is used to gate position research at 300s. Because it is always refreshed every 120s, `researchPosition()` never runs.
- **Impact:** Held positions never receive LLM re-evaluation; sell/hold decisions are missing a core safety loop.
- **Where:** `src/durable-objects/mahoraga-harness.ts` (alarm loop around the `lastResearchRun` checks).
- **Fix:** Split timers (e.g., `lastSignalResearchRun` and `lastPositionResearchRun`) and update each independently.

**2) Daily loss and cooldown policy are effectively dead**
- **What:** `recordDailyLoss()` and `setCooldown()` are defined but never called. `daily_loss_usd` and `cooldown_until` never change from defaults unless manually updated.
- **Impact:** Policy checks for max daily loss and cooldown are non-functional; approvals can keep passing even after large losses.
- **Where:** `src/storage/d1/queries/risk-state.ts` (functions exist), no usage found in codebase.
- **Fix:** Wire loss/cooldown updates into trade execution or order fill handling (both MCP and harness paths).

**3) Kill switch is inconsistent across subsystems**
- **What:** MCP `kill-switch-enable` updates D1 and cancels orders, but the autonomous harness does **not** consult D1 risk state. Separately, `/agent/kill` disables the harness DO but does **not** set the D1 kill switch, so MCP orders can still proceed.
- **Impact:** "Kill switch" is not a single source of truth and can be bypassed depending on which entry point is used.
- **Where:** `src/mcp/agent.ts` (kill switch tools), `src/durable-objects/mahoraga-harness.ts` (alarm loop, `handleKillSwitch`).
- **Fix:** Centralize kill switch state (D1 or DO), and ensure both MCP and harness respect and update it consistently.

---

### Medium

**4) Approval token ID mismatch**
- **What:** `generateApprovalToken()` creates an `approvalId` for the token, but `createApproval()` generates its own row ID. The token ID and DB row ID diverge.
- **Impact:** Traceability and correlation break (token ID != approval row ID). Future analytics or audit queries will be misleading.
- **Where:** `src/policy/approval.ts` and `src/storage/d1/queries/approvals.ts`.
- **Fix:** Pass the generated ID into `createApproval()` and store it as the row ID, or build token signature using the DB row ID.

**5) Trade table stores incorrect qty for notional orders**
- **What:** `createTrade()` writes `qty ?? notional ?? 0` into the `qty` column, but `trades` has no `notional` column.
- **Impact:** Trade records for notional orders are inaccurate and can't be reconciled with actual fills.
- **Where:** `src/storage/d1/queries/trades.ts`.
- **Fix:** Add a `notional` column (migration) or store `qty` and `notional` separately; don't coerce notional into `qty`.

**6) Trade status never updates**
- **What:** `updateTradeStatus()` exists but is unused. Trade lifecycle isn't updated after submission.
- **Impact:** `trades` table quickly becomes stale and not useful for ops or analytics.
- **Where:** `src/storage/d1/queries/trades.ts` (unused function).
- **Fix:** Add a periodic reconciliation job or update status on webhook/poll.

**7) Policy config validation is unused**
- **What:** `validatePolicyConfig()` and `validateOptionsPolicyConfig()` are defined but never called, even for DB-stored configs.
- **Impact:** Invalid configs can silently bypass or break policy enforcement.
- **Where:** `src/policy/config.ts`.
- **Fix:** Validate configs on load and on any future update path.

**8) Policy config fields are unused in enforcement**
- **What:** `min_avg_volume` and `min_price` are defined in `PolicyConfig` but never checked in `PolicyEngine`.
- **Impact:** Documented risk constraints are not enforced.
- **Where:** `src/policy/config.ts`, `src/policy/engine.ts`.
- **Fix:** Implement checks or remove fields to avoid false security.

**9) Feature flags are not applied to the autonomous harness**
- **What:** `FEATURE_LLM_RESEARCH` and `FEATURE_OPTIONS` are only used in MCP; the harness ignores them.
- **Impact:** Deploy-level feature toggles don't actually disable LLM/options in the 24/7 agent.
- **Where:** `src/mcp/agent.ts` vs `src/durable-objects/mahoraga-harness.ts`.
- **Fix:** Gate harness LLM and options behavior on the same flags, or document the separation.

---

### Low

**10) SessionDO is unused**
- **What:** `SessionDO` and `SESSION` binding exist, but no code path references them.
- **Impact:** Extra DO binding and code to maintain; can confuse ops.
- **Where:** `src/durable-objects/session.ts`, `wrangler.jsonc`.
- **Fix:** Remove or wire into request auth/rate limiting.

**11) Tool log redaction utilities are unused**
- **What:** `sanitizeForLog()` exists, but `insertToolLog()` stores raw input/output JSON.
- **Impact:** Potential leakage of sensitive fields in logs (especially as tools expand).
- **Where:** `src/lib/utils.ts`, `src/storage/d1/queries/tool-logs.ts`.
- **Fix:** Sanitize before insert, and add log retention/cleanup policy.

**12) Env docs drift**
- **What:** `wrangler.jsonc` comments mention `vercel-gateway`, but code expects `cloudflare-gateway` for `LLM_PROVIDER`.
- **Impact:** Misconfiguration risk for deploys.
- **Where:** `wrangler.jsonc`, `src/providers/llm/factory.ts`.
- **Fix:** Align comments and accepted values.

---

## Recommended Next Steps (Order of Impact)

1. Fix `lastResearchRun` split and wire position research timer.
2. Implement risk state updates (`recordDailyLoss`, `setCooldown`) in trade execution paths.
3. Unify kill switch state and enforce it in the harness alarm loop.
4. Fix approval ID mismatch and trade record correctness.
5. Validate policy config on load and enforce missing policy fields.
6. Add log sanitization and data retention policies.

---

## Notes

- This audit intentionally excludes the storage/cron/DO storage findings already covered in `audits/storage-and-cron-audit.md`.
- No changes were made to code in this audit; it is documentation-only.
