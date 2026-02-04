# MAHORAGA Storage & Cron Audit

**Date:** 2026-02-04
**Branch:** `feat/aggressive-100-position-config`

---

## Table of Contents

1. [Cron Jobs](#1-cron-jobs)
2. [KV Namespace (CACHE)](#2-kv-namespace-cache)
3. [R2 Bucket (ARTIFACTS)](#3-r2-bucket-artifacts)
4. [D1 Databases](#4-d1-databases)
5. [Durable Object Storage](#5-durable-object-storage)
6. [Summary of Findings](#6-summary-of-findings)

---

## 1. Cron Jobs

Defined in `wrangler.jsonc` (lines 95-102), handled in `src/jobs/cron.ts`.

| Cron Expression | Schedule | Handler | Status |
|---|---|---|---|
| `*/5 13-20 * * 1-5` | Every 5 min, 1-8 PM ET, weekdays | `runEventIngestion()` | **ACTIVE** |
| `0 14 * * 1-5` | 2 PM ET, weekdays | `runMarketOpenPrep()` | **ACTIVE** |
| `30 21 * * 1-5` | 9:30 PM ET, weekdays | `runMarketCloseCleanup()` | **ACTIVE** |
| `0 5 * * *` | 5 AM ET, daily | `runMidnightReset()` | **ACTIVE** |
| `0 * * * *` | Every hour | `runHourlyCacheRefresh()` | **UNUSED (STUB)** |

### Detail

**Event Ingestion** (`*/5 13-20 * * 1-5`) — Checks Alpaca market clock, polls SEC EDGAR for 8-K filings, deduplicates via D1 `raw_events` table. Critical for feeding the trading pipeline.

**Market Open Prep** (`0 14 * * 1-5`) — Logs risk state, cleans up expired order approvals. Name is misleading (runs 4.5h after market open at 9:30 AM). Really a mid-market cleanup.

**Market Close Cleanup** (`30 21 * * 1-5`) — Fetches end-of-day positions and equity from Alpaca, logs summary, cleans up expired approvals.

**Midnight Reset** (`0 5 * * *`) — Resets daily loss counter to 0, clears cooldown, cleans up expired approvals. Critical for daily risk tracking.

**Hourly Cache Refresh** (`0 * * * *`) — **EMPTY IMPLEMENTATION**. Logs one line and returns. The TODO comment says "Implement cache refresh for KV-cached data (movers, macro, etc.)" but nothing was ever built.

### Issues

| Issue | Severity |
|---|---|
| `runHourlyCacheRefresh()` is a no-op running 24x/day | Medium |
| `cleanupExpiredApprovals()` called 3x/day (market open prep, market close, midnight) — approvals have 5min TTL so 3 cleanups is overkill | Low |
| "Market Open Prep" name is misleading (runs at 2 PM, not 9:30 AM) | Low |

---

## 2. KV Namespace (CACHE)

### Binding

```jsonc
// wrangler.jsonc
"kv_namespaces": [{
  "binding": "CACHE",
  "id": "30b249fc59e84600998eb0c268f57413"
}]
```

Typed in `src/env.d.ts` as `CACHE: KVNamespace`.

### Infrastructure Built

| File | Contents | Used? |
|---|---|---|
| `src/storage/kv/client.ts` | Full KVClient wrapper (get, set, delete, list, getOrSet) | **NO** |
| `src/storage/kv/keys.ts` | Cache key schema (CacheKeys, CacheTTL) for movers, macro, technicals, signals, news | **NO** |

### Verdict: **COMPLETELY UNUSED**

- `createKVClient()` is exported but never called
- `CacheKeys` and `CacheTTL` are defined but never imported
- No code anywhere accesses `env.CACHE`
- The hourly cache refresh cron was supposed to populate this but was never implemented

### Recommendation

Either implement the caching layer or remove:
- KV binding from `wrangler.jsonc`
- `CACHE` from `src/env.d.ts`
- `src/storage/kv/client.ts`
- `src/storage/kv/keys.ts`

---

## 3. R2 Bucket (ARTIFACTS)

### Binding

```jsonc
// wrangler.jsonc
"r2_buckets": [{
  "binding": "ARTIFACTS",
  "bucket_name": "mahoraga-artifacts"
}]
```

Typed in `src/env.d.ts` as `ARTIFACTS: R2Bucket`.

### Infrastructure Built

| File | Contents | Used? |
|---|---|---|
| `src/storage/r2/client.ts` | Full R2Client wrapper (get, put, delete, list, etc.) | **NO** |
| `src/storage/r2/paths.ts` | Path templates for news articles, reports, raw events, scraped content, trade snapshots | **NO** |

### D1 Schema Hooks (also unused)

Two D1 tables have nullable `r2_key` columns designed to reference R2 objects:
- `raw_events.r2_key` — never populated by `insertRawEvent()` callers
- `news_items.r2_key` — never populated (`insertNewsItem()` is itself never called)

### Verdict: **COMPLETELY UNUSED**

No data flows to or from R2. The binding, client, paths, and D1 schema columns are all present but disconnected.

### Recommendation

Either implement R2 storage or remove:
- R2 binding from `wrangler.jsonc`
- `ARTIFACTS` from `src/env.d.ts`
- `src/storage/r2/client.ts`
- `src/storage/r2/paths.ts`
- `r2_key` columns from D1 tables (via migration)

---

## 4. D1 Databases

### 4a. Main API Database (`mahoraga-db`)

**Binding:** `DB` in mahoraga-api worker
**Migrations:** `/migrations/` (3 files)

| Table | Purpose | Operations | Status |
|---|---|---|---|
| `tool_logs` | MCP tool execution logs | C/R | **ACTIVE** |
| `order_approvals` | Trade approval tokens | C/R/U/D | **ACTIVE** |
| `trades` | Trade records | C/R/U | **ACTIVE** |
| `risk_state` | Singleton risk state (kill switch, daily loss) | R/U | **ACTIVE** |
| `policy_config` | Singleton policy config JSON | R/U | **ACTIVE** |
| `trade_journal` | Trade outcome analysis | C/R/U | **ACTIVE** |
| `memory_rules` | Learned trading rules | R | **ACTIVE** |
| `memory_preferences` | Agent preferences | R/U | **ACTIVE** |
| `raw_events` | Raw SEC/news event ingestion | C/R | **ACTIVE** |
| `structured_events` | Parsed/classified events | C/R/U | **ACTIVE** |
| `event_sources` | Event polling config | R/U | **ACTIVE** |
| `news_items` | News headlines/summaries | C/R | **ACTIVE** |

**Verdict:** All 12 tables are actively used. No dead tables.

**Minor notes:**
- `news_items` has an `r2_key` column that is never populated (see R2 section)
- `raw_events` has an `r2_key` column that is never populated (see R2 section)
- `insertNewsItem()` function exists but has no callers in the codebase — may be called from MCP tools at runtime

### 4b. Leaderboard Database (`mahoraga-leaderboard-db`)

**Binding:** `DB` in mahoraga-leaderboard worker
**Migrations:** `/leaderboard/db/migrations/` (7 files)

| Table | Purpose | Operations | Status |
|---|---|---|---|
| `traders` | Registered leaderboard participants | C/R/U | **ACTIVE** |
| `oauth_tokens` | Encrypted Alpaca OAuth tokens | C/R/U | **ACTIVE** |
| `performance_snapshots` | Daily trader metrics | C/R/U | **ACTIVE** |
| `equity_history` | Time-series equity curves | C/R/U | **ACTIVE** |
| `trades` | Synced trade records | C/R/U/D | **ACTIVE** |

**Verdict:** All 5 tables are actively used. No dead tables. Schema has been through 7 migrations and is well-optimized.

---

## 5. Durable Object Storage

### 5a. SessionDO (`src/durable-objects/session.ts`)

**Storage key:** `"state"` (SessionState object)

| Field | Used? |
|---|---|
| `authenticated` | Yes — read/write on every auth action |
| `authenticatedAt` | Yes |
| `requestCount` | Yes — incremented per request |
| `lastRequestAt` | Yes |
| `rateLimitResetAt` | Yes |
| `metadata` | Yes |

**Verdict:** Clean, all fields used, properly bounded.

### 5b. MahoragaHarness (`src/durable-objects/mahoraga-harness.ts`)

**Storage key:** `"state"` (monolithic AgentState object, serialized entirely on every persist)

#### Actively Used Fields

| Field | Type | Bounded? | Notes |
|---|---|---|---|
| `config` | AgentConfig | Yes (fixed size) | 34 trading parameters |
| `enabled` | boolean | Yes | Global enable flag |
| `signalCache` | Signal[] | Yes (max 200) | Trimmed in runDataGatherers() |
| `logs` | LogEntry[] | Yes (max 500) | Trimmed in log() |
| `costTracker` | CostTracker | Yes (fixed size) | LLM spend tracking |
| `positionEntries` | Record<symbol, PositionEntry> | Yes (~100 max) | Deleted on sell |
| `stalenessAnalysis` | Record<symbol, unknown> | Yes (~100 max) | Deleted on position close |
| `premarketPlan` | PremarketPlan \| null | Yes (TTL 600s) | Pre-market only |
| `lastDataGatherRun` | number | Yes | Throttle timer |
| `lastAnalystRun` | number | Yes | Throttle timer |
| `lastResearchRun` | number | Yes | Throttle timer |
| `twitterDailyReads` | number | Yes | Reset daily |
| `twitterDailyReadReset` | number | Yes | Reset daily |

#### Problem Fields

| Field | Issue | Severity |
|---|---|---|
| **`socialHistory`** | **DEAD FIELD** — declared and initialized as `{}` but never written to. Returned in status endpoint and deleted on position close, but no code ever populates it. | **High** |
| **`signalResearch`** | **UNBOUNDED** — grows with every unique symbol researched. TTL logic exists in memory (180s) but entries are never deleted from the storage object. Accumulates indefinitely. | **High** |
| **`positionResearch`** | **UNBOUNDED** — only deleted when a position closes via `executeSell()`. Not cleared on kill switch (inconsistent with other caches cleared at line 1212-1214). Stale research persists. | **High** |
| **`twitterConfirmations`** | **UNBOUNDED** — TTL logic in memory (300s) but no storage-level deletion. Accumulates if Twitter is enabled. | **Medium** |

#### Estimated Storage Size

| Component | Typical | Worst Case |
|---|---|---|
| config + metadata | ~2 KB | ~2 KB |
| signalCache (200 items) | ~100 KB | ~100 KB |
| positionEntries (100 positions) | ~200 KB | ~200 KB |
| logs (500 items) | ~250 KB | ~250 KB |
| signalResearch (unbounded) | ~500 KB | **10+ MB** |
| positionResearch (unbounded) | ~100 KB | **5+ MB** |
| twitterConfirmations (unbounded) | ~200 KB | **5+ MB** |
| **TOTAL** | **~1.3 MB** | **20+ MB** |

#### Persistence Gap

State is only persisted at the end of each alarm cycle (~30s intervals). Mutations during a cycle (position entries, research results, cost tracking) are at risk of data loss if the DO crashes mid-cycle.

---

## 6. Summary of Findings

### Unused Resources (safe to remove)

| Resource | Type | Files Affected |
|---|---|---|
| `CACHE` KV namespace | Binding + dead code | `wrangler.jsonc`, `env.d.ts`, `src/storage/kv/*` |
| `ARTIFACTS` R2 bucket | Binding + dead code | `wrangler.jsonc`, `env.d.ts`, `src/storage/r2/*` |
| `runHourlyCacheRefresh()` cron | No-op cron trigger | `wrangler.jsonc`, `src/jobs/cron.ts` |
| `socialHistory` DO field | Dead state field | `src/durable-objects/mahoraga-harness.ts` |
| `r2_key` D1 columns | Unused schema columns | `raw_events`, `news_items` tables |

### Active Resources (all healthy)

| Resource | Type | Status |
|---|---|---|
| `mahoraga-db` D1 | 12 tables | All actively used |
| `mahoraga-leaderboard-db` D1 | 5 tables | All actively used |
| 4 active cron jobs | Event ingestion, market prep, close cleanup, midnight reset | All functioning |
| SessionDO storage | 6 fields | All used, properly bounded |
| MahoragaHarness storage | 13+ active fields | Functioning but has growth concerns |

### Bugs / Risks

| Issue | Severity | Location |
|---|---|---|
| `signalResearch` grows unbounded | High | `mahoraga-harness.ts` — no max size or expiration |
| `positionResearch` grows unbounded | High | `mahoraga-harness.ts` — no cleanup for closed positions |
| `positionResearch` not cleared on kill switch | Medium | `mahoraga-harness.ts` ~line 1212 — inconsistent with other caches |
| `twitterConfirmations` grows unbounded | Medium | `mahoraga-harness.ts` — no storage-level deletion |
| No persistence after critical mutations | Medium | `executeBuy()`, `researchSignal()` etc. — ~30s data loss window |
| `cleanupExpiredApprovals()` called 3x/day | Low | Overkill for 5-min TTL approvals |
