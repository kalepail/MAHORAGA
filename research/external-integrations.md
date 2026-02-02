# External Integrations Audit

Current state: Alpaca and social APIs use raw `fetch()` with typed response interfaces. OpenAI uses the official SDK. No other official SDKs are viable for the Cloudflare Workers runtime.

`nodejs_compat` is already enabled in `wrangler.jsonc` (with `compatibility_date: 2024-12-01`, `nodejs_compat_v2` is automatically active). This was evaluated for enabling additional SDK packages — see the Alpaca and Twitter sections for findings.

---

## 1. Alpaca (Trading, Market Data, Options, Crypto)

**Status:** Custom `AlpacaClient` with generic typed `request<T>()` method. Staying bespoke.

**Files:**
- `src/providers/alpaca/client.ts` — Base HTTP client, auth headers, generic `tradingRequest<T>()` and `dataRequest<T>()`
- `src/providers/alpaca/trading.ts` — Order management, positions, account
- `src/providers/alpaca/market-data.ts` — Bars, quotes, snapshots (stocks + crypto)
- `src/providers/alpaca/options.ts` — Options contracts and snapshots
- `src/providers/alpaca/index.ts` — Factory (`createAlpacaProviders`)
- `src/providers/types.ts` — Typed interfaces for all Alpaca responses (Account, Position, Order, Bar, Quote, Snapshot, Asset, etc.)

**Auth:** Custom headers `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`

**Base URLs:**
- Trading (paper): `https://paper-api.alpaca.markets`
- Trading (live): `https://api.alpaca.markets`
- Data: `https://data.alpaca.markets`

**Endpoints used:**
- `/v2/account`
- `/v2/positions`, `/v2/positions/{symbol}`
- `/v2/orders`, `/v2/orders/{id}`
- `/v2/clock`, `/v2/calendar`
- `/v2/assets/{symbol}`
- `/v2/stocks/{symbol}/bars`, `/v2/stocks/{symbol}/bars/latest`
- `/v2/stocks/bars/latest` (batch)
- `/v2/stocks/{symbol}/quotes/latest`, `/v2/stocks/quotes/latest` (batch)
- `/v2/stocks/{symbol}/snapshot`, `/v2/stocks/snapshots` (batch)
- `/v1beta3/crypto/us/snapshots/{symbol}`
- `/v2/options/contracts`
- `/v1beta1/options/snapshots`

**Error handling:** Maps 401→UNAUTHORIZED, 403→FORBIDDEN, 404→NOT_FOUND, 422→INVALID_INPUT, 429→RATE_LIMITED. Typed order body as `Record<string, string | boolean>`.

**Why not the official SDK:**
`@alpacahq/alpaca-trade-api` depends on `ws` (WebSocket), which uses native Node.js `http`/`net` modules. Even with `nodejs_compat` enabled, `ws` does not work on Cloudflare Workers — the polyfills don't cover raw socket creation. The SDK also pulls in `axios`, adding unnecessary weight. Our custom client is ~110 lines, uses only `fetch()`, and is fully CF Workers compatible.

**References:**
- npm: https://www.npmjs.com/package/@alpacahq/alpaca-trade-api
- API Docs: https://docs.alpaca.markets/reference

---

## 2. OpenAI (LLM)

**Status: Migrated to official SDK.** Uses `openai@^6.16.0`.

**Files:**
- `src/providers/llm/openai.ts` — `OpenAIProvider` wrapping the SDK client
- `src/providers/llm/classifier.ts` — Event classification, research reports, rule summarization
- `src/providers/types.ts` — `CompletionParams` uses `ChatCompletionCreateParams["messages"]` and `ChatCompletionCreateParams["response_format"]` from the SDK
- `src/durable-objects/mahoraga-harness.ts` — Direct SDK usage for analyst decisions

**Auth:** `new OpenAI({ apiKey, baseURL })` — SDK handles the Bearer token

**Feature gate:** `FEATURE_LLM_RESEARCH`

**Models used:**
- `gpt-4o` — Deep research, analyst decisions
- `gpt-4o-mini` — Quick analysis, event classification, position research

**Use cases:**
1. Event classification (earnings, mergers, lawsuits → `EventType`)
2. Equity research report generation (with `TechnicalIndicators` context)
3. Trading journal pattern extraction / rule summarization
4. Signal analysis and trading decisions
5. Position risk assessment

**Why the SDK works here:** `openai@6.x` has zero native Node.js dependencies. It uses `fetch()` internally, making it fully CF Workers compatible.

---

## 3. StockTwits (Social Sentiment)

**Status:** Raw `fetch()`, inline in harness. No SDK exists.

**File:** `src/durable-objects/mahoraga-harness.ts` (method: `gatherStockTwits()`)

**Base URL:** `https://api.stocktwits.com/api/2`

**Endpoints:**
- `GET /trending/symbols.json`
- `GET /streams/symbol/{symbol}.json?limit=30`

**Auth:** None (public API)

**Response types (named interfaces in harness):**
- `StockTwitsTrendingResponse` — `{ symbols?: Array<{ symbol: string }> }`
- `StockTwitsStreamResponse` — `{ messages?: Array<{ entities?: { sentiment?: { basic?: string } }; created_at?: string }> }`

**Data extracted:** Bullish/Bearish sentiment counts, time-decayed scoring, source weighting

---

## 4. Reddit (Social Sentiment)

**Status:** Raw `fetch()`, inline in harness. No viable SDK for CF Workers.

**File:** `src/durable-objects/mahoraga-harness.ts` (method: `gatherReddit()`)

**Endpoint:** `https://www.reddit.com/r/{subreddit}/hot.json?limit=25`

**Auth:** `User-Agent: Mahoraga/2.0`

**Subreddits monitored:** wallstreetbets, stocks, investing, options (each with configurable source weight)

**Response type (named interface in harness):**
- `RedditListingResponse` — nested `data.children[].data` with `title`, `selftext`, `created_utc`, `ups`, `num_comments`, `link_flair_text`

**Data extracted:** Ticker mentions via regex extraction, sentiment analysis, engagement multipliers, flair-based quality scoring, time decay

---

## 5. Twitter (Social Sentiment + Confirmation)

**Status:** Raw `fetch()`, inline in harness. SDK incompatible with CF Workers.

**File:** `src/durable-objects/mahoraga-harness.ts` (methods: `twitterSearchRecent()`, `gatherTwitterConfirmation()`, `checkTwitterBreakingNews()`)

**Endpoint:** `https://api.twitter.com/2/tweets/search/recent`

**Auth:** `Authorization: Bearer <TWITTER_BEARER_TOKEN>`

**Budget:** 200 API reads/day (tracked and enforced internally)

**Response type (named interface in harness):**
- `TwitterSearchResponse` — `data[]` with tweet fields + `includes.users[]` with author metrics

**Use cases:**
1. Signal confirmation — boosts/reduces confidence on existing signals
2. Breaking news detection — monitors FinTwit accounts (FirstSquawk, DeItaone, Newsquawk)

**Why not the official SDK:**
`twitter-api-v2` depends on `node:https` for HTTP requests. Even with `nodejs_compat` and `enable_nodejs_http_modules`, there are no confirmed successful deployments of this package on Cloudflare Workers.

**References:**
- npm: https://www.npmjs.com/package/twitter-api-v2

---

## 6. Discord (Webhooks)

**Status:** Raw `fetch()`, inline in harness. Fire-and-forget POST.

**File:** `src/durable-objects/mahoraga-harness.ts` (method: `sendDiscordNotification()`)

**Endpoint:** `${DISCORD_WEBHOOK_URL}` (env secret)

**Auth:** Token embedded in webhook URL

**Payload:** Discord embed format (`{ embeds: [{ title, color, fields, description, timestamp, footer }] }`)

**Notification types:**
- `signal` — High sentiment signal detected
- `research` — Buy/skip/wait verdict with confidence and catalysts

**Rate limiting:** Per-symbol cooldown of 30 minutes

**No SDK needed:** Discord webhooks are a single POST endpoint. A library would add overhead for no benefit.

---

## 7. SEC EDGAR (Corporate Filings / News)

**Status:** Raw `fetch()` with regex XML parsing. Dedicated provider file.

**File:** `src/providers/news/sec-edgar.ts`

**Endpoints:**
- `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&...&output=atom` — ATOM feed
- `https://data.sec.gov/submissions/CIK{cik}.json` — Company filing data
- `https://www.sec.gov/files/company_tickers.json` — Ticker-to-CIK mapping

**Auth:** `User-Agent` header per SEC requirements

**Response types:**
- `SECCompanyFiling` — named interface for company JSON
- Ticker mapping — typed inline as `Record<string, { cik_str: number; ticker: string; title: string }>`

**Forms tracked:** 8-K, 4, 13F-HR, 10-K, 10-Q, SC 13D, SC 13G

**Known risk:** ATOM feed parsing uses regex, which is fragile. Consider `fast-xml-parser` if feed format changes become an issue.

---

## 8. Web Scraper (Financial Data Extraction)

**Status:** Raw `fetch()` with regex HTML parsing. Dedicated provider file.

**File:** `src/providers/scraper.ts`

**Whitelisted domains:**
1. `finance.yahoo.com`
2. `www.sec.gov`
3. `stockanalysis.com`
4. `companiesmarketcap.com`

**Response type:** `ScrapeResult` — `{ url, domain, title, text, timestamp, truncated }`

**Features:**
- 10s timeout with `AbortController`
- 500KB content size limit
- HTML cleaning (strips scripts, styles, nav, header, footer)
- HTML entity decoding
- Financial pattern recognition (prices, percent changes, keywords)

**Known risk:** Regex HTML parsing is fragile and the custom entity decoder is incomplete. Consider `cheerio` or `linkedom` if scraping becomes unreliable.

---

## 9. Infrastructure

### Cloudflare Workers
- **D1** — SQLite database (`src/storage/d1/client.ts`, typed `SqlParam` for query params)
- **Durable Objects** — Agent harness (`src/durable-objects/mahoraga-harness.ts`), session state (`src/durable-objects/session.ts`)
- **KV / R2** — Bindings declared in `wrangler.jsonc` but wrapper clients removed; used only through native bindings if needed

### SDKs
- `openai` v6.16.0 — LLM completions
- `@modelcontextprotocol/sdk` v1.0.0 — MCP server protocol
- `agents` v0.0.74 — Cloudflare `McpAgent` base class
- `zod` v3.23.8 — Schema validation for MCP tool inputs

### Compatibility
- `nodejs_compat` enabled in `wrangler.jsonc`
- `compatibility_date: 2024-12-01` (activates `nodejs_compat_v2` automatically)

---

## Summary Table

| Service | Method | Auth | Response Types | SDK Status |
|---|---|---|---|---|
| Alpaca | Custom `fetch()` client | API key headers | Named interfaces in `types.ts` | Official SDK incompatible (depends on `ws`) |
| OpenAI | Official SDK (`openai`) | SDK-managed Bearer token | SDK types (`ChatCompletionCreateParams`) | **Migrated** |
| StockTwits | Raw `fetch()` | None (public) | Named interfaces in harness | No SDK exists |
| Reddit | Raw `fetch()` | User-Agent | Named interface in harness | No viable CF Workers SDK |
| Twitter | Raw `fetch()` | Bearer token | Named interface in harness | SDK incompatible (`node:https`) |
| Discord | Raw `fetch()` | URL-embedded token | Inline embed format | Not needed (single POST) |
| SEC EDGAR | Raw `fetch()` | User-Agent | Named interfaces in provider | No full SDK; regex XML is a risk |
| Web Scraper | Raw `fetch()` | None | Named interface in provider | `cheerio`/`linkedom` as future option |

---

## Remaining Opportunities

1. **SEC EDGAR XML parsing** — Replace regex ATOM parsing with `fast-xml-parser` if the feed format becomes unstable. Low priority since it works today.
2. **Web scraper HTML parsing** — Replace regex with `cheerio` if scraping reliability degrades. Low priority for the same reason.
3. **Alpaca type imports** — If Alpaca publishes a types-only package or the SDK drops the `ws` dependency, re-evaluate migration. Monitor their GitHub releases.
