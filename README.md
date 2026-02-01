# Mahoraga

Autonomous trading agent powered by social sentiment analysis.

Mahoraga monitors StockTwits for trending stocks and automatically executes trades through Alpaca based on configurable risk parameters. It's designed as a starting point for building your own trading strategies.

## Features

- **24/7 Sentiment Monitoring** - Scrapes StockTwits trending stocks
- **Automatic Risk Management** - Stop-loss, take-profit, position limits, kill switch
- **Real-Time Dashboard** - Monitor positions, signals, and agent activity
- **Paper Trading Mode** - Test safely before going live
- **MCP Server Architecture** - Extensible tool-based design for adding your own data sources
- **Policy Engine** - All trades validated against configurable risk rules

## Requirements

- Node.js 18+
- Alpaca account (free, paper trading supported)
- OpenAI API key (optional - for advanced AI features)

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url>
cd mahoraga
npm install
cd dashboard && npm install && cd ..
```

### 2. Configure API keys

Create a `.dev.vars` file in the project root:

```bash
ALPACA_API_KEY=your_alpaca_key
ALPACA_API_SECRET=your_alpaca_secret
ALPACA_PAPER=true
OPENAI_API_KEY=your_openai_key
KILL_SWITCH_SECRET=any_random_string_here
```

> **Important**: Always start with `ALPACA_PAPER=true` until you understand how the system works.

### 3. Initialize the database

```bash
npm run db:migrate
```

### 4. Start the MCP server

```bash
npm run dev
```

The server runs at `http://localhost:8787`

### 5. Start the trading agent

In a new terminal:

```bash
node agent-v1.mjs
```

> **Note**: `agent-v1.mjs` is a simple rules-based agent using StockTwits sentiment. It's a great starting point for building your own strategy.

### 6. Start the dashboard (optional)

In a new terminal:

```bash
cd dashboard
npm run dev
```

Open `http://localhost:5173` in your browser.

## Getting API Keys

### Alpaca (Required)

1. Create a free account at [alpaca.markets](https://alpaca.markets)
2. Go to **Paper Trading** > **API Keys**
3. Click **Generate New Keys**
4. Copy both the key and secret

> Start with paper trading. Switch to live only after thorough testing.

### OpenAI (Optional - for advanced features)

The basic agent (`agent-v1.mjs`) doesn't require OpenAI. If you want to build LLM-powered features:

1. Create an account at [platform.openai.com](https://platform.openai.com)
2. Add billing and credits ($10 is plenty to start)
3. Go to **API Keys** > **Create new secret key**
4. Add to `.dev.vars`: `OPENAI_API_KEY=sk-your_key`

## Configuration

Edit `agent-config.json` (created on first run) or use the dashboard:

| Setting | Default | Description |
|---------|---------|-------------|
| `max_positions` | 3 | Maximum stocks to hold at once |
| `max_position_value` | 2000 | Maximum $ per position |
| `take_profit_pct` | 8 | Auto-sell at this % profit |
| `stop_loss_pct` | 4 | Auto-sell at this % loss |
| `min_sentiment_score` | 0.4 | Minimum bullish sentiment to consider |
| `min_volume` | 10 | Minimum message volume to consider |
| `position_size_pct_of_cash` | 20 | Max % of cash per position |

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AGENT (agent-v1.mjs)                    │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐     ┌─────────────────────────────────┐    │
│  │   StockTwits    │     │      Simple Trading Logic       │    │
│  │   Data Source   │────▶│  (rules-based buy/sell)         │    │
│  │     (FREE)      │     │                                 │    │
│  └─────────────────┘     └──────────────┬──────────────────┘    │
└─────────────────────────────────────────┼───────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP SERVER (Cloudflare Workers)              │
├─────────────────────────────────────────────────────────────────┤
│  Policy Engine → Approval Tokens → Order Execution              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Alpaca    │
                    │   Broker    │
                    └─────────────┘
```

### Trading Logic

**Data Gathering (runs 24/7)**
- Fetches trending stocks from StockTwits
- Calculates sentiment score (bullish vs bearish messages)
- Caches signals for trading decisions

**Trading Loop (market hours only)**
- Checks existing positions for stop-loss/take-profit
- Evaluates new buy opportunities based on sentiment
- Executes trades through MCP server

### Order Flow (Two-Step Safety)

All orders go through a two-step process:

1. **Preview** (`orders-preview`) - Validates against policy, returns approval token
2. **Submit** (`orders-submit`) - Executes with valid token

This prevents accidental trades and enforces risk limits.

## Safety Features

| Feature | Description |
|---------|-------------|
| Paper Trading | Default mode - no real money at risk |
| Kill Switch | Emergency halt for all trading |
| Position Limits | Max positions and $ per position |
| Daily Loss Limit | Stops trading after 2% daily loss |
| Cooldown Period | 30-minute pause after losses |
| Approval Tokens | Orders expire after 5 minutes |
| No Margin | Cash-only trading |
| No Shorting | Long positions only |

## Estimated Costs

### API Costs

The basic agent uses **only free APIs**:
- StockTwits API (free, no key required)
- Alpaca paper trading (free)

**Live trading**: Alpaca is commission-free for stocks.

## Project Structure

```
mahoraga/
├── agent-v1.mjs              # Trading agent - COPY AND MODIFY THIS
├── .dev.vars                 # API keys (DO NOT COMMIT)
├── agent-config.json         # Runtime config (DO NOT COMMIT)
├── agent-logs.json           # Activity logs (DO NOT COMMIT)
├── wrangler.toml             # Cloudflare Workers config
├── package.json
│
├── src/                      # MCP Server (you probably don't need to touch this)
│   ├── index.ts              # Entry point
│   ├── mcp/
│   │   └── agent.ts          # MCP tool definitions
│   ├── policy/
│   │   ├── engine.ts         # Trade validation logic
│   │   ├── config.ts         # Policy configuration
│   │   └── approval.ts       # Token generation/validation
│   ├── providers/
│   │   ├── alpaca/           # Alpaca API client
│   │   ├── llm/              # OpenAI integration (optional)
│   │   └── technicals.ts     # Technical indicators
│   └── storage/
│       └── d1/               # Database queries
│
├── dashboard/                # React dashboard
│   ├── src/
│   │   ├── App.tsx           # Main dashboard
│   │   └── components/
│   └── package.json
│
└── migrations/               # Database migrations
```

## Troubleshooting

### "Failed to connect to MCP server"

Make sure the MCP server is running:
```bash
npm run dev
```

### "Invalid API key"

Check your `.dev.vars` file has correct Alpaca keys.

### "Market is closed"

The agent only trades during market hours (9:30 AM - 4:00 PM ET, Mon-Fri). It gathers data 24/7 but won't execute trades when markets are closed.

### Agent not making trades

1. Check `min_sentiment_score` - might be too high (try 0.3)
2. Check `max_positions` - might already be at limit
3. Check `min_volume` - might be filtering out signals
4. Check logs in dashboard or `agent-logs.json`

## Extending the Agent

**Copy `agent-v1.mjs` and modify it.** The file has clearly marked sections:

```
┌─────────────────────────────────────────────────────────────────┐
│  SECTION 1: DATA SOURCE (customize this)                        │
│  - StockTwitsAgent class                                        │
│  - Add your own: Reddit, Twitter, news APIs, etc.               │
├─────────────────────────────────────────────────────────────────┤
│  SECTION 2: TRADING STRATEGY (customize this)                   │
│  - runTradingLogic() method                                     │
│  - Change buy/sell rules, add technical indicators, etc.        │
├─────────────────────────────────────────────────────────────────┤
│  SECTION 3: HARNESS (probably don't touch)                      │
│  - MCP connection, execution, dashboard API                     │
│  - Modify only if you know what you're doing                    │
└─────────────────────────────────────────────────────────────────┘
```

### Available MCP Tools

The MCP server provides these tools for your agents:

| Tool | Description |
|------|-------------|
| `accounts-get` | Get account balance and status |
| `positions-list` | List current positions |
| `positions-close` | Close a position |
| `orders-preview` | Preview order and get approval token |
| `orders-submit` | Submit approved order |
| `orders-list` | List recent orders |
| `market-clock` | Check if market is open |
| `market-quote` | Get stock quote |
| `technicals-get` | Get technical indicators (RSI, MACD, etc.) |
| `catalog-list` | List all available tools |

### Ideas for Extension

1. **Add more data sources**: Reddit, Twitter/X, news APIs, SEC filings
2. **Add LLM analysis**: Use OpenAI to evaluate signals and generate insights  
3. **Add technical indicators**: Use the `technicals-get` MCP tool
4. **Multi-source confirmation**: Require 2+ sources to agree before trading
5. **Options trading**: The MCP server supports options via Alpaca

## Disclaimer

**This software is for educational purposes only.**

- Trading involves substantial risk of loss
- Past performance does not guarantee future results
- Always start with paper trading
- This is not financial advice
- The authors are not responsible for any trading losses

Use at your own risk.

## License

MIT License - Free for personal and commercial use.
