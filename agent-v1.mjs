#!/usr/bin/env node

/**
 * Mahoraga v1 - Simple Trading Agent
 * 
 * COPY THIS FILE and modify it for your own strategy.
 * 
 * The file has three sections:
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  SECTION 1: DATA SOURCE (line ~150)                             │
 * │  - StockTwitsAgent class - fetches sentiment data               │
 * │  - CUSTOMIZE: Add Reddit, Twitter, news APIs, etc.              │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  SECTION 2: TRADING STRATEGY (line ~380)                        │
 * │  - runTradingLogic() method - decides when to buy/sell          │
 * │  - CUSTOMIZE: Change buy/sell rules, add indicators, etc.       │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  SECTION 3: HARNESS (line ~450+)                                │
 * │  - MCP connection, order execution, dashboard API               │
 * │  - PROBABLY DON'T TOUCH unless you know what you're doing       │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * MIT License - Free for personal and commercial use
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .dev.vars
function loadEnvFile() {
  const envPath = path.join(__dirname, ".dev.vars");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=").trim();
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFile();

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_PATH = path.join(process.cwd(), "agent-config.json");
const LOG_PATH = path.join(process.cwd(), "agent-logs.json");

const DEFAULT_CONFIG = {
  mcp_url: process.env.MCP_URL || "http://localhost:8787/mcp",
  
  // Polling intervals
  data_poll_interval_ms: 60_000,      // Data gatherer polls every 60s
  analyst_interval_ms: 120_000,        // Trading logic runs every 2 min
  
  // Trading parameters
  max_position_value: 2000,            // Max $ per position
  max_positions: 3,                    // Max concurrent positions
  min_sentiment_score: 0.4,            // Minimum bullish sentiment to buy
  min_volume: 10,                      // Minimum message volume
  
  // Risk management
  take_profit_pct: 8,                  // Auto-sell at this % profit
  stop_loss_pct: 4,                    // Auto-sell at this % loss
  position_size_pct_of_cash: 20,       // Max % of cash per position
  
  // Account config
  starting_equity: 100000,             // Starting equity for P&L calculation
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      return { ...DEFAULT_CONFIG, ...saved };
    }
  } catch (e) {
    console.error("Failed to load config:", e.message);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================================================
// Activity Logger
// ============================================================================

class ActivityLogger {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    this.entries = [];
    this.costTracker = { total_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0 };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(LOG_PATH)) {
        const data = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
        this.entries = data.entries || [];
        this.costTracker = data.costTracker || this.costTracker;
      }
    } catch (e) {
      console.error("Failed to load logs:", e.message);
    }
  }

  save() {
    const data = { entries: this.entries.slice(-this.maxEntries), costTracker: this.costTracker };
    fs.writeFileSync(LOG_PATH, JSON.stringify(data, null, 2));
  }

  log(agent, action, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      agent,
      action,
      ...details,
    };
    this.entries.push(entry);
    console.log(`[${entry.timestamp}] [${agent}] ${action}`, details.symbol ? `(${details.symbol})` : "");
    
    if (this.entries.length % 10 === 0) {
      this.save();
    }
    return entry;
  }

  getRecentLogs(limit = 50) {
    return this.entries.slice(-limit);
  }

  getCosts() {
    return this.costTracker;
  }
}

// ============================================================================
// ============================================================================
//
//   SECTION 1: DATA SOURCE
//
//   This is where signals come from. Currently uses StockTwits (free, no API key).
//   
//   TO CUSTOMIZE: Add your own data sources here. Examples:
//   - Reddit API (r/wallstreetbets, r/stocks)
//   - Twitter/X API 
//   - News APIs (NewsAPI, Polygon, Alpha Vantage)
//   - Your own proprietary signals
//
//   Each source should return signals in this format:
//   { symbol, source, sentiment (-1 to 1), volume, reason }
//
// ============================================================================
// ============================================================================

class StockTwitsAgent {
  constructor(logger) {
    this.logger = logger;
    this.name = "StockTwits";
  }

  async getTrending() {
    try {
      const res = await fetch("https://api.stocktwits.com/api/2/trending/symbols.json");
      if (!res.ok) return [];
      const data = await res.json();
      this.logger.log(this.name, "fetched_trending", { count: data.symbols?.length || 0 });
      return data.symbols || [];
    } catch (err) {
      this.logger.log(this.name, "error", { message: err.message });
      return [];
    }
  }

  async getStream(symbol) {
    try {
      const res = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json?limit=30`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || [];
    } catch (err) {
      return [];
    }
  }

  analyzeSentiment(messages) {
    let bullish = 0, bearish = 0;
    
    for (const msg of messages) {
      const sentiment = msg.entities?.sentiment?.basic;
      if (sentiment === "Bullish") bullish++;
      else if (sentiment === "Bearish") bearish++;
    }
    
    const total = messages.length;
    return {
      bullish,
      bearish,
      total,
      score: total > 0 ? (bullish - bearish) / total : 0,
    };
  }

  async gatherSignals() {
    const signals = [];
    const trending = await this.getTrending();
    
    for (const sym of trending.slice(0, 10)) {
      const messages = await this.getStream(sym.symbol);
      const sentiment = this.analyzeSentiment(messages);
      
      if (sentiment.total >= 5) {
        signals.push({
          symbol: sym.symbol,
          source: "stocktwits",
          sentiment: sentiment.score,
          volume: sentiment.total,
          bullish: sentiment.bullish,
          bearish: sentiment.bearish,
          reason: `StockTwits: ${sentiment.bullish}B/${sentiment.bearish}b (${(sentiment.score * 100).toFixed(0)}%)`,
        });
      }
      await sleep(300);
    }
    
    this.logger.log(this.name, "gathered_signals", { count: signals.length });
    return signals;
  }
}

// ============================================================================
// Trading Executor
// ============================================================================

class TradingExecutor {
  constructor(mcpClient, logger, config) {
    this.mcp = mcpClient;
    this.logger = logger;
    this.config = config;
    this.name = "Executor";
    this.lastTrades = new Map();
  }

  async callTool(name, args = {}) {
    const result = await this.mcp.callTool({ name, arguments: args });
    return JSON.parse(result.content[0].text);
  }

  async executeBuy(symbol, confidence, reasonText = "") {
    // Cooldown check (5 min)
    const lastTrade = this.lastTrades.get(symbol);
    if (lastTrade && Date.now() - lastTrade < 300_000) {
      this.logger.log(this.name, "skipped_cooldown", { symbol });
      return null;
    }

    const account = await this.callTool("accounts-get");
    if (!account.ok) return null;

    // Calculate position size
    const sizePct = this.config.position_size_pct_of_cash;
    const positionSize = Math.min(
      account.data.cash * (sizePct / 100) * confidence,
      this.config.max_position_value
    );

    if (positionSize < 100) {
      this.logger.log(this.name, "skipped_size", { symbol, size: positionSize });
      return null;
    }

    this.logger.log(this.name, "preview_buy", { symbol, size: positionSize.toFixed(2) });

    const preview = await this.callTool("orders-preview", {
      symbol,
      side: "buy",
      notional: Math.round(positionSize * 100) / 100,
      order_type: "market",
      time_in_force: "day",
    });

    if (!preview.ok) {
      this.logger.log(this.name, "preview_failed", { symbol, error: preview.error?.message });
      return null;
    }

    if (!preview.data.policy.allowed) {
      const violationMsgs = (preview.data.policy.violations || []).map(v => v.message || v.rule).join("; ");
      this.logger.log(this.name, "policy_rejected", { symbol, violations: violationMsgs });
      return null;
    }

    const submit = await this.callTool("orders-submit", {
      approval_token: preview.data.policy.approval_token,
    });

    if (submit.ok) {
      this.lastTrades.set(symbol, Date.now());
      this.logger.log(this.name, "buy_executed", {
        symbol,
        status: submit.data.order.status,
        size: positionSize.toFixed(2),
        reason: reasonText,
      });
      return submit.data.order;
    } else {
      this.logger.log(this.name, "buy_failed", { symbol, error: submit.error?.message });
      return null;
    }
  }

  async executeSell(symbol, reason) {
    this.logger.log(this.name, "sell_initiated", { symbol, reason });
    
    const result = await this.callTool("positions-close", { symbol });
    
    if (result.ok) {
      this.logger.log(this.name, "sell_executed", { symbol, reason });
      return result.data.order;
    } else {
      this.logger.log(this.name, "sell_failed", { symbol, error: result.error?.message });
      return null;
    }
  }
}

// ============================================================================
// Main Orchestrator
// ============================================================================

class SimpleOrchestrator {
  constructor() {
    this.config = loadConfig();
    this.logger = new ActivityLogger();
    this.signalCache = [];
    this.lastAnalystRun = 0;
    
    this.stocktwits = new StockTwitsAgent(this.logger);
    this.executor = null;
    this.mcp = null;
  }

  async connect() {
    const transport = new SSEClientTransport(new URL(this.config.mcp_url));
    this.mcp = new Client({ name: "mahoraga-v1", version: "1.0" }, { capabilities: {} });
    
    try {
      await this.mcp.connect(transport);
      this.executor = new TradingExecutor(this.mcp, this.logger, this.config);
      this.logger.log("System", "connected", { url: this.config.mcp_url });
      return true;
    } catch (err) {
      this.logger.log("System", "connection_failed", { error: err.message });
      return false;
    }
  }

  async getAccountState() {
    const [account, positions, clock] = await Promise.all([
      this.executor.callTool("accounts-get"),
      this.executor.callTool("positions-list"),
      this.executor.callTool("market-clock"),
    ]);
    return {
      account: account.ok ? account.data : null,
      positions: positions.ok ? positions.data.positions : [],
      clock: clock.ok ? clock.data : null,
    };
  }

  async runDataGatherers() {
    this.logger.log("System", "gathering_data");
    
    const stocktwitsSignals = await this.stocktwits.gatherSignals();
    this.signalCache = stocktwitsSignals;
    
    this.logger.log("System", "data_gathered", {
      stocktwits: stocktwitsSignals.length,
      total: stocktwitsSignals.length,
    });

    return stocktwitsSignals;
  }

  // ==========================================================================
  // ==========================================================================
  //
  //   SECTION 2: TRADING STRATEGY  
  //
  //   This is the brain - decides when to buy and sell.
  //
  //   TO CUSTOMIZE:
  //   - Change the buy conditions (sentiment thresholds, volume, etc.)
  //   - Change the sell conditions (take profit, stop loss, etc.)
  //   - Add technical indicators using MCP's "technicals-get" tool
  //   - Add LLM analysis using MCP's "symbol-research" tool
  //   - Require multiple data sources to agree before trading
  //
  // ==========================================================================
  // ==========================================================================

  async runTradingLogic() {
    const { account, positions, clock } = await this.getAccountState();
    
    if (!account) {
      this.logger.log("System", "skipped_trading", { reason: "No account data" });
      return;
    }

    if (!clock?.is_open) {
      this.logger.log("System", "market_closed");
      return;
    }

    const heldSymbols = new Set(positions.map(p => p.symbol));

    // ========================================================================
    // STEP 1: Check existing positions for exit signals
    // ========================================================================
    for (const pos of positions) {
      const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100;
      
      // Take profit
      if (plPct >= this.config.take_profit_pct) {
        this.logger.log("System", "take_profit_triggered", { symbol: pos.symbol, pnl: plPct.toFixed(2) });
        await this.executor.executeSell(pos.symbol, `Take profit at +${plPct.toFixed(1)}%`);
        continue;
      }
      
      // Stop loss
      if (plPct <= -this.config.stop_loss_pct) {
        this.logger.log("System", "stop_loss_triggered", { symbol: pos.symbol, pnl: plPct.toFixed(2) });
        await this.executor.executeSell(pos.symbol, `Stop loss at ${plPct.toFixed(1)}%`);
        continue;
      }
    }

    // ========================================================================
    // STEP 2: Look for new buy opportunities
    // ========================================================================
    if (positions.length >= this.config.max_positions) {
      this.logger.log("System", "max_positions_reached", { count: positions.length });
      return;
    }

    // Filter signals to find buy candidates
    const buyCandidates = this.signalCache
      .filter(s => !heldSymbols.has(s.symbol))
      .filter(s => s.sentiment >= this.config.min_sentiment_score)
      .filter(s => s.volume >= this.config.min_volume)
      .sort((a, b) => b.sentiment - a.sentiment);

    this.logger.log("System", "buy_candidates", { count: buyCandidates.length });

    // Try to buy top candidates
    for (const signal of buyCandidates.slice(0, 3)) {
      if (positions.length >= this.config.max_positions) break;
      
      // Use sentiment as confidence (0-1 scale)
      const confidence = Math.min(1, Math.max(0.5, signal.sentiment + 0.3));
      
      this.logger.log("System", "considering_buy", { 
        symbol: signal.symbol, 
        sentiment: signal.sentiment.toFixed(2),
        volume: signal.volume,
      });
      
      const result = await this.executor.executeBuy(signal.symbol, confidence, signal.reason);
      
      if (result) {
        heldSymbols.add(signal.symbol);
        // Don't spam - one buy per cycle
        break;
      }
    }

    this.lastAnalystRun = Date.now();
  }

  // ==========================================================================
  // ==========================================================================
  //
  //   SECTION 3: HARNESS (you probably don't need to modify this)
  //
  //   This handles:
  //   - MCP server connection
  //   - Scheduling data gathering and trading loops
  //   - Dashboard API for the React frontend
  //   - Logging and config persistence
  //
  // ==========================================================================
  // ==========================================================================

  async run() {
    console.log("\n========================================");
    console.log("  MAHORAGA v1 - Simple Trading Agent");
    console.log("========================================\n");
    
    if (!(await this.connect())) {
      console.error("Failed to connect. Make sure MCP server is running: npm run dev");
      process.exit(1);
    }

    // Initial state
    const { account, positions, clock } = await this.getAccountState();
    if (account) {
      console.log(`Equity: $${account.equity.toFixed(2)} | Cash: $${account.cash.toFixed(2)} | Positions: ${positions.length}`);
    }
    console.log(`Market: ${clock?.is_open ? "OPEN" : "CLOSED"}\n`);

    // Save config
    saveConfig(this.config);

    // Run initial data gathering
    await this.runDataGatherers();
    
    if (clock?.is_open) {
      await this.runTradingLogic();
    }

    // Schedule recurring runs
    console.log(`Data gathering: every ${this.config.data_poll_interval_ms / 1000}s`);
    console.log(`Trading logic: every ${this.config.analyst_interval_ms / 1000}s (market hours only)\n`);

    // Data gatherers (runs 24/7)
    setInterval(async () => {
      try {
        await this.runDataGatherers();
      } catch (err) {
        this.logger.log("System", "error", { phase: "data_gathering", error: err.message });
      }
    }, this.config.data_poll_interval_ms);

    // Trading logic (only during market hours)
    setInterval(async () => {
      try {
        const { clock } = await this.getAccountState();
        if (!clock?.is_open) {
          return;
        }
        await this.runTradingLogic();
      } catch (err) {
        this.logger.log("System", "error", { phase: "trading", error: err.message });
      }
    }, this.config.analyst_interval_ms);

    // Save state periodically
    setInterval(() => {
      this.logger.save();
      saveConfig(this.config);
    }, 60_000);
  }

  getStatus() {
    return {
      config: this.config,
      signals: this.signalCache,
      logs: this.logger.getRecentLogs(100),
      costs: this.logger.getCosts(),
      lastAnalystRun: this.lastAnalystRun,
      // v1 doesn't have advanced features
      signalResearch: {},
      positionResearch: {},
      twitterConfirmations: {},
      stalenessAnalysis: {},
      positionTracking: {},
      optionsEnabled: false,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// HTTP API for Dashboard
// ============================================================================

function startDashboardAPI(orchestrator) {
  const PORT = orchestrator.config.dashboard_port || process.env.DASHBOARD_PORT || 3001;
  
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    try {
      if (url.pathname === "/api/status") {
        const { account, positions, clock } = await orchestrator.getAccountState();
        const status = orchestrator.getStatus();
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          data: {
            account,
            positions,
            clock,
            ...status,
          },
        }));
      } else if (url.pathname === "/api/config" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: orchestrator.config }));
      } else if (url.pathname === "/api/config" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => {
          try {
            const newConfig = JSON.parse(body);
            orchestrator.config = { ...orchestrator.config, ...newConfig };
            saveConfig(orchestrator.config);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, data: orchestrator.config }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      } else if (url.pathname === "/api/logs") {
        const limit = parseInt(url.searchParams.get("limit") || "100");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: orchestrator.logger.getRecentLogs(limit) }));
      } else if (url.pathname === "/api/costs") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: orchestrator.logger.getCosts() }));
      } else if (url.pathname === "/api/setup/status") {
        const hasAlpaca = !!(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET);
        const hasOpenAI = !!process.env.OPENAI_API_KEY;
        const startingEquity = orchestrator.config.starting_equity || 100000;
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          ok: true, 
          data: { 
            configured: hasAlpaca,
            has_alpaca: hasAlpaca,
            has_openai: hasOpenAI,
            starting_equity: startingEquity,
            paper_mode: process.env.ALPACA_PAPER === "true"
          } 
        }));
      } else if (url.pathname === "/api/setup/keys" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => {
          try {
            const { alpaca_key, alpaca_secret, openai_key, paper_mode, starting_equity } = JSON.parse(body);
            
            // Build .dev.vars content
            let envContent = "";
            if (alpaca_key) envContent += `ALPACA_API_KEY=${alpaca_key}\n`;
            if (alpaca_secret) envContent += `ALPACA_API_SECRET=${alpaca_secret}\n`;
            envContent += `ALPACA_PAPER=${paper_mode !== false ? "true" : "false"}\n`;
            if (openai_key) envContent += `OPENAI_API_KEY=${openai_key}\n`;
            envContent += `KILL_SWITCH_SECRET=mahoraga_kill_${Date.now()}\n`;
            
            // Write to .dev.vars
            const envPath = path.join(__dirname, ".dev.vars");
            fs.writeFileSync(envPath, envContent);
            
            // Update config with starting equity
            if (starting_equity) {
              orchestrator.config.starting_equity = starting_equity;
              saveConfig(orchestrator.config);
            }
            
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ 
              ok: true, 
              message: "Configuration saved. Please restart the agent." 
            }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });

  server.listen(PORT, () => {
    console.log(`Dashboard API: http://localhost:${PORT}`);
    console.log(`  GET  /api/status  - Full status`);
    console.log(`  GET  /api/config  - Get config`);
    console.log(`  POST /api/config  - Update config`);
    console.log(`  GET  /api/logs    - Activity logs\n`);
  });
}

// ============================================================================
// Entry Point
// ============================================================================

const orchestrator = new SimpleOrchestrator();
startDashboardAPI(orchestrator);
orchestrator.run().catch(console.error);
