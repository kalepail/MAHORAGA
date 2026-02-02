# MAHORAGA Leaderboard

A community leaderboard for MAHORAGA autonomous trading agents. Traders register their fork, connect their Alpaca paper trading account via OAuth (read-only), and compete on verified performance metrics.

Live on Cloudflare Workers. Built with Vite + React. Styled in the MAHORAGA HUD aesthetic.

---

## Architecture

```
leaderboard/
  src/                    # React frontend (SPA)
  worker/                 # Cloudflare Worker backend (API + OAuth)
  db/                     # D1 schema and migrations
  wrangler.jsonc          # Cloudflare config
  vite.config.ts          # Vite + Cloudflare plugin
```

**Stack:** React 19, Vite 6, Tailwind CSS 4, Cloudflare Workers, D1 (SQLite), `@cloudflare/vite-plugin`

**Deployment:** Single `wrangler deploy`. The Vite plugin handles both static asset bundling and Worker compilation. Frontend served via Workers Assets (free, no Worker invocations). API routes handled by the Worker.

---

## Alpaca OAuth Integration (Read-Only, Paper-Only)

This is the key insight that makes the leaderboard trustworthy without requiring users to share secrets. Alpaca calls this the **Connect API** (their name for OAuth 2.0).

### Paper Trading Enforcement (Two Layers)

The leaderboard enforces paper-only access at **two independent levels**:

1. **Authorization time**: The `env=paper` parameter on the OAuth authorize URL restricts the flow so the user is **only prompted to authorize a paper account**. They never see a live account option.

2. **API call time**: All data fetches hit `paper-api.alpaca.markets` exclusively. Even if a token somehow had live access, our code never calls the live endpoint.

### Read-Only Enforcement (Zero Scopes)

Alpaca has three OAuth scopes:

| Scope | Grants |
|-------|--------|
| `account:write` | Modify account configurations and watchlists |
| `trading` | Place, cancel, or modify orders |
| `data` | Access to Data API |

**Read-only endpoint access is the implicit default.** By omitting all scopes entirely (not even requesting `data`), the token receives the minimum possible permissions: read-only access to the Trading API. No ability to trade, modify, or write anything.

### Flow

1. User clicks "Connect Alpaca" on leaderboard site
2. Redirect to `https://app.alpaca.markets/oauth/authorize` with:
   - `response_type=code`
   - `client_id=OUR_APP_CLIENT_ID`
   - `redirect_uri=https://leaderboard.mahoraga.dev/api/oauth/callback`
   - `env=paper` (restricts to paper account only)
   - `state=random_csrf_token` (CSRF protection)
   - **No `scope` parameter** (read-only is the default)
3. User sees Alpaca's authorization page for their **paper account only**
4. User approves read-only access
5. Alpaca redirects back with a temporary `code` (expires in 10 minutes)
6. Our Worker exchanges the code for an access token via `POST https://api.alpaca.markets/oauth/token`
7. We use the token to fetch account data from `paper-api.alpaca.markets`, then store it encrypted

### What We Can Read

All calls go to `https://paper-api.alpaca.markets/v2/` with `Authorization: Bearer <token>`:

| Endpoint | Data |
|----------|------|
| `GET /v2/account` | Equity, cash, buying power, daily P&L (`equity - last_equity`) |
| `GET /v2/positions` | Open positions, unrealized P&L, cost basis |
| `GET /v2/account/portfolio/history` | Historical equity curve, profit_loss timeseries |
| `GET /v2/account/activities/CSD` | Cash deposit history |
| `GET /v2/account/activities/FILL` | All trade fills (for realized P&L calculation) |
| `GET /v2/orders?status=closed` | Complete order history |

### What We CANNOT Do

- Place, modify, or cancel orders (no `trading` scope)
- Change account settings or watchlists (no `account:write` scope)
- Access the user's API key or secret (OAuth never exposes these)
- Transfer funds
- Touch any live/real-money account (`env=paper` + paper-only endpoint)

### OAuth App Registration

1. Log in to the Alpaca Dashboard (`app.alpaca.markets`)
2. Navigate to "OAuth Apps" in the left menu
3. Click "Create New App" and fill in details (name, redirect URI, description)
4. Receive `client_id` and `client_secret` immediately

**No approval needed for paper trading.** The docs confirm that paper trading OAuth works immediately upon app creation. Alpaca approval is only required for live trading on behalf of other users.

### Token Lifecycle

Based on Alpaca documentation and community confirmations:

- **Access tokens do not appear to expire.** Alpaca does not document an expiration time or provide a refresh token mechanism for the Connect API (unlike the Broker API).
- **Authorization codes expire in 10 minutes.** Must be exchanged immediately.
- The token response contains `access_token`, `token_type`, and `scope` but no `expires_in` or `refresh_token` fields.
- **No refresh flow needed.** Store the access token (encrypted) and use it indefinitely. If a token stops working, prompt the user to re-authorize.
- Users can revoke access at any time from their Alpaca dashboard.

### Deduplication

When a user connects via OAuth, we fetch their Alpaca account ID from `GET /v2/account` and store it. This prevents the same paper trading account from being linked to multiple leaderboard profiles.

### Known Risk: GitHub Issue #268

There is an [open GitHub issue](https://github.com/alpacahq/Alpaca-API/issues/268) (since Dec 2024) where some developers report OAuth authorization failing with "unknown client" errors. This may be a configuration issue rather than a systemic problem. **Recommendation: register the OAuth app early and test the flow before building out the full integration.**

### Why Not API Keys?

Individual Alpaca Trading API keys (from `app.alpaca.markets`) are full-access. There is no way for a user to generate a read-only key from their personal dashboard. The granular credential management (Read Only, Custom scopes) only exists in the Broker API, which is a B2B product requiring business signup. OAuth is the only mechanism for delegated, scoped, read-only access to an individual trader's account.

---

## Data Model (D1 Schema)

```sql
-- Registered traders
CREATE TABLE traders (
  id TEXT PRIMARY KEY,                    -- ulid
  username TEXT NOT NULL UNIQUE,          -- display name (3-20 chars, alphanumeric + underscore)
  github_repo TEXT NOT NULL,              -- full github url to their fork
  bio TEXT,                               -- short bio (max 280 chars)
  avatar_url TEXT,                        -- github avatar or custom
  asset_class TEXT NOT NULL DEFAULT 'stocks', -- 'stocks', 'crypto', or 'both'
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT,                    -- last successful Alpaca data pull
  is_verified INTEGER NOT NULL DEFAULT 0, -- 1 = Alpaca OAuth connected
  is_active INTEGER NOT NULL DEFAULT 1    -- 0 = hidden from leaderboard
);

-- Alpaca OAuth tokens (encrypted at rest via ENCRYPTION_KEY)
CREATE TABLE oauth_tokens (
  trader_id TEXT PRIMARY KEY REFERENCES traders(id),
  access_token_encrypted TEXT NOT NULL,
  alpaca_account_id TEXT UNIQUE,           -- for dedup (one Alpaca account per leaderboard entry)
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT                        -- last successful API call
);

-- Snapshots of trader performance (pulled from Alpaca daily)
CREATE TABLE performance_snapshots (
  id TEXT PRIMARY KEY,                    -- ulid
  trader_id TEXT NOT NULL REFERENCES traders(id),
  snapshot_date TEXT NOT NULL,            -- YYYY-MM-DD
  equity REAL NOT NULL,                   -- total account equity
  cash REAL NOT NULL,
  total_deposits REAL NOT NULL DEFAULT 0, -- sum of all CSD activities
  total_pnl REAL NOT NULL,               -- equity - total_deposits
  total_pnl_pct REAL NOT NULL,           -- (equity - total_deposits) / total_deposits
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  day_pnl REAL NOT NULL DEFAULT 0,       -- equity - last_equity
  num_trades INTEGER NOT NULL DEFAULT 0, -- total closed orders
  num_winning_trades INTEGER NOT NULL DEFAULT 0,
  win_rate REAL,                          -- num_winning / num_trades
  max_drawdown_pct REAL,                 -- worst peak-to-trough
  sharpe_ratio REAL,                     -- calculated from daily returns
  open_positions INTEGER NOT NULL DEFAULT 0,
  UNIQUE(trader_id, snapshot_date)
);

-- Equity curve points (for sparklines and charts)
CREATE TABLE equity_history (
  id TEXT PRIMARY KEY,
  trader_id TEXT NOT NULL REFERENCES traders(id),
  timestamp TEXT NOT NULL,
  equity REAL NOT NULL,
  profit_loss REAL NOT NULL,
  profit_loss_pct REAL NOT NULL
);

-- Individual trades (from Alpaca activities/FILL)
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  trader_id TEXT NOT NULL REFERENCES traders(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,                     -- 'buy' or 'sell'
  qty REAL NOT NULL,
  price REAL NOT NULL,
  filled_at TEXT NOT NULL,
  asset_class TEXT NOT NULL DEFAULT 'stocks'
);
```

### Computed Metrics (Not Stored, Calculated at Query Time)

- **ROI %**: `(equity - total_deposits) / total_deposits * 100`
- **Composite Score**: `0.4 * normalized_roi + 0.3 * normalized_sharpe + 0.15 * normalized_win_rate + 0.15 * normalized_inverse_drawdown`
- **Streak**: consecutive days with positive day_pnl

---

## Leaderboard Ranking System

### Primary Sort: Composite Score

A single number that balances performance, risk, and consistency:

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| ROI % | 40% | Raw returns |
| Sharpe Ratio | 30% | Risk-adjusted quality |
| Win Rate | 15% | Consistency |
| 1 - Max Drawdown % | 15% | Capital preservation |

Each component is min-max normalized across all traders before weighting. This prevents any single dimension from dominating and naturally penalizes reckless gambling (high returns but terrible Sharpe and drawdown).

### Alternative Sort Options

Users can sort the leaderboard by any individual metric:
- Composite Score (default)
- ROI %
- Total P&L ($)
- Sharpe Ratio
- Win Rate
- Max Drawdown (ascending = best)
- Number of Trades

### Filters

- **Asset Class**: Stocks, Crypto, Both, All
- **Time Period**: 7 days, 30 days, 90 days, All-Time
- **Verified Only**: Toggle to show only Alpaca-verified accounts
- **Minimum Trades**: Slider (default 10)
- **Search**: By username

### Time Period Logic

Performance metrics are recalculated for the selected window:
- **7d**: Snapshots from last 7 days
- **30d**: Last 30 days (default view)
- **90d**: Last 90 days
- **All-Time**: Since trader joined

---

## Anti-Gaming Measures

### Phase 1 (Launch)

These are low-effort, high-impact controls:

1. **Verified badge** -- Only Alpaca OAuth-connected accounts show as verified. Unverified accounts can register but are clearly marked and ranked separately.

2. **Minimum trades threshold** -- Must have 10+ trades in the selected period to appear on leaderboard. Prevents lucky one-shot wonders.

3. **Composite score ranking** -- Using Sharpe ratio in the composite naturally punishes reckless gambling. A trader who YOLOs everything into one position will have terrible Sharpe even if ROI is high.

4. **Full trade transparency** -- Every trader's individual trades are visible on their profile. The community can review and flag suspicious patterns.

5. **One account per GitHub** -- Tied to GitHub identity. Duplicate detection via Alpaca account ID.

6. **Data from Alpaca, not self-reported** -- All performance numbers come directly from the Alpaca API. Users cannot manually enter or modify their stats.

### Phase 2 (Future)

- Drawdown disqualification (>50% drawdown = flagged)
- Statistical outlier detection (returns >3 std dev from mean)
- Position concentration alerts (>25% in single position)
- Community reporting system
- IP/device fingerprinting for multi-account detection

---

## Pages & Routes

### `/` -- Leaderboard (Home)

The centerpiece. A ranked table of traders with:

- **Rank number** with movement indicator (up/down/new)
- **Username** (clickable to profile)
- **Verified badge** (checkmark if Alpaca-connected)
- **ROI %** with color (green/red)
- **Total P&L** ($)
- **Sharpe Ratio**
- **Win Rate**
- **Max Drawdown**
- **Trades** count
- **Equity sparkline** (tiny chart, last 30 days)
- **Asset class** badge (stocks/crypto/both)
- **Joined** date

Above the table:
- Filter bar (asset class, time period, verified toggle, search)
- Sort dropdown
- Total traders count, total volume

### `/trader/:username` -- Trader Profile

Detailed view of a single trader:

- **Header**: Username, bio, GitHub link, verified status, joined date
- **Key metrics**: Large display of ROI, P&L, Sharpe, Win Rate, Drawdown
- **Equity curve chart**: Full interactive chart of account equity over time
- **Open positions**: Current holdings with unrealized P&L
- **Trade history**: Paginated list of all trades
- **Deposits**: Total deposited amount (for context on absolute P&L)
- **GitHub repo link**: Direct link to their fork with "Review Code" CTA

### `/join` -- Getting Started

How to participate:

1. **Fork the repo** -- Link to main MAHORAGA GitHub with instructions
2. **Set up your agent** -- Brief setup guide, link to main docs
3. **Register on the leaderboard** -- Form to submit username + GitHub URL
4. **Connect Alpaca** -- OAuth flow to verify your account
5. **Start trading** -- Your agent runs, leaderboard updates daily

### `/about` -- The Story

Community building content:

- **What is MAHORAGA** -- Brief explainer of the autonomous trading agent
- **The Challenge** -- Build the best-performing trading agent
- **How Rankings Work** -- Transparent explanation of the composite score
- **Verification** -- How Alpaca OAuth ensures honest numbers
- **Open Source** -- Everything is forkable, auditable, transparent
- **FAQ** -- Common questions

---

## API Routes (Worker)

All routes prefixed with `/api/`.

### Public (No Auth)

```
GET  /api/leaderboard              -- Paginated leaderboard with filters/sort
GET  /api/leaderboard/stats        -- Aggregate stats (total traders, volume, etc.)
GET  /api/trader/:username         -- Public trader profile
GET  /api/trader/:username/trades  -- Paginated trade history
GET  /api/trader/:username/equity  -- Equity curve data points
```

### OAuth Flow

```
GET  /api/oauth/authorize          -- Initiate Alpaca OAuth (redirects to Alpaca)
GET  /api/oauth/callback           -- Handle Alpaca redirect, store tokens
```

### Authenticated (Bearer token from registration)

```
POST /api/register                 -- Register new trader (username, github_repo, bio)
PUT  /api/trader/:username         -- Update profile (bio, github_repo)
POST /api/trader/:username/sync    -- Manually trigger Alpaca data sync
```

### Internal (Cron)

```
POST /api/cron/sync-all            -- Daily sync of all trader data from Alpaca
POST /api/cron/compute-rankings    -- Recalculate composite scores and rankings
```

---

## Design System

Inherits the MAHORAGA HUD aesthetic -- dark sci-fi terminal theme:

### Colors
```
Background:      #0a0c0e
Panel:           #0d1012
Primary:         #7a9ba8
Text:            #7a9ba8
Text Bright:     #c8dce4
Text Dim:        #4a5a62
Border:          rgba(122, 155, 168, 0.15)
Success (green): #4a9868
Warning (amber): #b89848
Error (red):     #b84848
Purple:          #8a6ab8
Cyan:            #5a9ab8
```

### Typography
- **Font**: JetBrains Mono (monospace)
- **Base**: 10px root, rem scaling
- **Labels**: 8px uppercase, letter-spacing 0.15em
- **Values**: 300 weight for large numbers, 400 for standard

### Components
- `.hud-panel` -- Card with subtle border
- `.hud-button` -- Transparent bordered, inverts on hover
- `.hud-input` -- Monospace input, focus border glow
- `.hud-label` / `.hud-value-*` -- Consistent metric display

### Additions for Leaderboard
- **Rank badges**: Gold (#b89848), Silver (#7a9ba8), Bronze (#8a6ab8) for top 3
- **Verified badge**: Cyan (#5a9ab8) checkmark
- **Sparkline**: Inline SVG equity chart, green/red based on trend
- **Movement indicators**: Up arrow (green), down arrow (red), dash (unchanged)
- **Asset class pills**: Small rounded badges (stocks = cyan, crypto = purple, both = primary)

---

## Implementation Phases

### Phase 1: Foundation

- [ ] Initialize Cloudflare Vite + React project
- [ ] Set up D1 schema and migrations
- [ ] Build leaderboard table component with mock data
- [ ] Build trader profile page with mock data
- [ ] Build /join page with registration form
- [ ] Build /about page
- [ ] Implement registration API (POST /api/register)
- [ ] Implement leaderboard API (GET /api/leaderboard)
- [ ] Implement trader profile API (GET /api/trader/:username)
- [ ] Style everything in HUD theme

### Phase 2: Alpaca Integration

- [ ] Register OAuth app with Alpaca
- [ ] Implement OAuth authorize/callback flow
- [ ] Build Alpaca data sync (account, positions, history, activities)
- [ ] Calculate derived metrics (Sharpe, drawdown, composite score)
- [ ] Set up daily cron sync
- [ ] Verified badge display
- [ ] Equity curve chart on profiles

### Phase 3: Polish & Community

- [ ] Rank movement tracking (compare to previous day)
- [ ] Search and advanced filtering
- [ ] Responsive mobile layout
- [ ] Social meta tags (OG images for sharing)
- [ ] Rate limiting on API
- [ ] Error handling and loading states
- [ ] GitHub repo validation (check fork exists)

### Phase 4: Future Ideas

- Badges and achievements system
- Monthly competitions with themed challenges
- Discord webhook integration for rank changes
- RSS feed of leaderboard updates
- Embeddable widgets for traders to put in their README
- Comments/discussion on trader profiles
- Copy-strategy feature (link to fork instructions)
