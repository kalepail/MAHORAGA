/**
 * TradingAgentDO - Basic Durable Object trading agent
 * 
 * A simple, rules-based trading agent that runs on Cloudflare Workers.
 * Uses DO alarms instead of setInterval for scheduling.
 * 
 * Features:
 * - StockTwits sentiment monitoring
 * - Basic stop-loss and take-profit
 * - Configurable trading parameters
 * - Dashboard API for monitoring
 * 
 * For advanced features (LLM analysis, multi-source aggregation, Twitter 
 * confirmation, options trading), see the premium version.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.d";
import { createAlpacaProviders } from "../providers/alpaca";
import type { Account, Position, MarketClock } from "../providers/types";

// ============================================================================
// Types
// ============================================================================

interface AgentConfig {
  // Polling intervals (in ms)
  data_poll_interval_ms: number;
  analyst_interval_ms: number;
  
  // Trading parameters
  max_position_value: number;
  max_positions: number;
  min_sentiment_score: number;
  min_volume: number;
  
  // Risk management
  take_profit_pct: number;
  stop_loss_pct: number;
  position_size_pct_of_cash: number;
}

interface Signal {
  symbol: string;
  source: string;
  sentiment: number;
  volume: number;
  bullish: number;
  bearish: number;
  reason: string;
}

interface LogEntry {
  timestamp: string;
  agent: string;
  action: string;
  [key: string]: unknown;
}

interface AgentState {
  config: AgentConfig;
  signalCache: Signal[];
  logs: LogEntry[];
  lastDataGatherRun: number;
  lastAnalystRun: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: AgentConfig = {
  data_poll_interval_ms: 60_000,
  analyst_interval_ms: 120_000,
  max_position_value: 2000,
  max_positions: 3,
  min_sentiment_score: 0.4,
  min_volume: 10,
  take_profit_pct: 8,
  stop_loss_pct: 4,
  position_size_pct_of_cash: 20,
};

const DEFAULT_STATE: AgentState = {
  config: DEFAULT_CONFIG,
  signalCache: [],
  logs: [],
  lastDataGatherRun: 0,
  lastAnalystRun: 0,
  enabled: false,
};

// ============================================================================
// TradingAgentDO
// ============================================================================

export class TradingAgentDO extends DurableObject<Env> {
  private state: AgentState = { ...DEFAULT_STATE };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<AgentState>("state");
      if (stored) {
        this.state = { ...DEFAULT_STATE, ...stored };
      }
    });
  }

  // ============================================================================
  // Alarm Handler (main entry point for scheduled work)
  // ============================================================================

  async alarm(): Promise<void> {
    if (!this.state.enabled) {
      this.log("System", "alarm_skipped", { reason: "Agent not enabled" });
      return;
    }

    const now = Date.now();
    
    try {
      const alpaca = createAlpacaProviders(this.env);
      const clock = await alpaca.trading.getClock();
      
      // Data gathering runs always (24/7)
      if (now - this.state.lastDataGatherRun >= this.state.config.data_poll_interval_ms) {
        await this.runDataGatherer();
        this.state.lastDataGatherRun = now;
      }
      
      // Trading logic only runs during market hours
      if (clock.is_open) {
        if (now - this.state.lastAnalystRun >= this.state.config.analyst_interval_ms) {
          await this.runTradingLogic();
          this.state.lastAnalystRun = now;
        }
      }
      
      await this.persist();
    } catch (error) {
      this.log("System", "alarm_error", { error: String(error) });
    }
    
    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm(): Promise<void> {
    const nextRun = Date.now() + 30_000;  // 30 seconds
    await this.ctx.storage.setAlarm(nextRun);
  }

  // ============================================================================
  // HTTP Handler (for dashboard/control)
  // ============================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);

    try {
      switch (action) {
        case "status":
          return this.handleStatus();
        
        case "config":
          if (request.method === "POST") {
            return this.handleUpdateConfig(request);
          }
          return this.jsonResponse({ config: this.state.config });
        
        case "enable":
          return this.handleEnable();
        
        case "disable":
          return this.handleDisable();
        
        case "logs":
          return this.handleGetLogs(url);
        
        case "signals":
          return this.jsonResponse({ signals: this.state.signalCache });
        
        case "trigger":
          // Manual trigger for testing
          await this.alarm();
          return this.jsonResponse({ ok: true, message: "Alarm triggered" });
        
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ error: String(error) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private async handleStatus(): Promise<Response> {
    const alpaca = createAlpacaProviders(this.env);
    
    let account: Account | null = null;
    let positions: Position[] = [];
    let clock: MarketClock | null = null;
    
    try {
      [account, positions, clock] = await Promise.all([
        alpaca.trading.getAccount(),
        alpaca.trading.getPositions(),
        alpaca.trading.getClock(),
      ]);
    } catch {
      // Ignore - will return null
    }
    
    return this.jsonResponse({
      enabled: this.state.enabled,
      account,
      positions,
      clock,
      config: this.state.config,
      signalCount: this.state.signalCache.length,
      lastDataGatherRun: this.state.lastDataGatherRun,
      lastAnalystRun: this.state.lastAnalystRun,
    });
  }

  private async handleUpdateConfig(request: Request): Promise<Response> {
    const body = await request.json() as Partial<AgentConfig>;
    this.state.config = { ...this.state.config, ...body };
    await this.persist();
    return this.jsonResponse({ ok: true, config: this.state.config });
  }

  private async handleEnable(): Promise<Response> {
    this.state.enabled = true;
    await this.persist();
    await this.scheduleNextAlarm();
    this.log("System", "agent_enabled", {});
    return this.jsonResponse({ ok: true, enabled: true });
  }

  private async handleDisable(): Promise<Response> {
    this.state.enabled = false;
    await this.ctx.storage.deleteAlarm();
    await this.persist();
    this.log("System", "agent_disabled", {});
    return this.jsonResponse({ ok: true, enabled: false });
  }

  private handleGetLogs(url: URL): Response {
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const logs = this.state.logs.slice(-limit);
    return this.jsonResponse({ logs });
  }

  // ============================================================================
  // Data Gathering (StockTwits only in basic version)
  // ============================================================================

  private async runDataGatherer(): Promise<void> {
    this.log("System", "gathering_data", {});
    
    const signals = await this.gatherStockTwits();
    this.state.signalCache = signals;
    
    this.log("System", "data_gathered", { count: signals.length });
  }

  private async gatherStockTwits(): Promise<Signal[]> {
    const signals: Signal[] = [];
    
    try {
      // Get trending symbols
      const trendingRes = await fetch("https://api.stocktwits.com/api/2/trending/symbols.json");
      if (!trendingRes.ok) return [];
      const trendingData = await trendingRes.json() as { symbols?: Array<{ symbol: string }> };
      const trending = trendingData.symbols || [];
      
      // Get sentiment for top trending
      for (const sym of trending.slice(0, 10)) {
        try {
          const streamRes = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${sym.symbol}.json?limit=30`);
          if (!streamRes.ok) continue;
          const streamData = await streamRes.json() as { 
            messages?: Array<{ entities?: { sentiment?: { basic?: string } } }> 
          };
          const messages = streamData.messages || [];
          
          // Analyze sentiment
          let bullish = 0, bearish = 0;
          for (const msg of messages) {
            const sentiment = msg.entities?.sentiment?.basic;
            if (sentiment === "Bullish") bullish++;
            else if (sentiment === "Bearish") bearish++;
          }
          
          const total = messages.length;
          const score = total > 0 ? (bullish - bearish) / total : 0;
          
          if (total >= 5) {
            signals.push({
              symbol: sym.symbol,
              source: "stocktwits",
              sentiment: score,
              volume: total,
              bullish,
              bearish,
              reason: `StockTwits: ${bullish}B/${bearish}b (${(score * 100).toFixed(0)}%)`,
            });
          }
          
          await this.sleep(300);
        } catch {
          continue;
        }
      }
    } catch (error) {
      this.log("StockTwits", "error", { message: String(error) });
    }
    
    return signals;
  }

  // ============================================================================
  // Trading Logic (Basic rules-based)
  // ============================================================================

  private async runTradingLogic(): Promise<void> {
    const alpaca = createAlpacaProviders(this.env);
    
    const [account, positions, clock] = await Promise.all([
      alpaca.trading.getAccount(),
      alpaca.trading.getPositions(),
      alpaca.trading.getClock(),
    ]);
    
    if (!account || !clock.is_open) {
      this.log("System", "trading_skipped", { reason: "Account unavailable or market closed" });
      return;
    }
    
    const heldSymbols = new Set(positions.map(p => p.symbol));
    
    // Step 1: Check existing positions for exit signals
    for (const pos of positions) {
      const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100;
      
      // Take profit
      if (plPct >= this.state.config.take_profit_pct) {
        this.log("System", "take_profit_triggered", { symbol: pos.symbol, pnl: plPct.toFixed(2) });
        await this.executeSell(alpaca, pos.symbol, `Take profit at +${plPct.toFixed(1)}%`);
        continue;
      }
      
      // Stop loss
      if (plPct <= -this.state.config.stop_loss_pct) {
        this.log("System", "stop_loss_triggered", { symbol: pos.symbol, pnl: plPct.toFixed(2) });
        await this.executeSell(alpaca, pos.symbol, `Stop loss at ${plPct.toFixed(1)}%`);
        continue;
      }
    }
    
    // Step 2: Look for new buy opportunities
    if (positions.length >= this.state.config.max_positions) {
      this.log("System", "max_positions_reached", { count: positions.length });
      return;
    }
    
    // Filter signals to find buy candidates
    const buyCandidates = this.state.signalCache
      .filter(s => !heldSymbols.has(s.symbol))
      .filter(s => s.sentiment >= this.state.config.min_sentiment_score)
      .filter(s => s.volume >= this.state.config.min_volume)
      .sort((a, b) => b.sentiment - a.sentiment);
    
    this.log("System", "buy_candidates", { count: buyCandidates.length });
    
    // Try to buy top candidate
    for (const signal of buyCandidates.slice(0, 1)) {
      if (positions.length >= this.state.config.max_positions) break;
      
      const confidence = Math.min(1, Math.max(0.5, signal.sentiment + 0.3));
      
      this.log("System", "considering_buy", { 
        symbol: signal.symbol, 
        sentiment: signal.sentiment.toFixed(2),
        volume: signal.volume,
      });
      
      const result = await this.executeBuy(alpaca, signal.symbol, confidence, account);
      if (result) {
        heldSymbols.add(signal.symbol);
        break;  // One buy per cycle
      }
    }
  }

  private async executeBuy(
    alpaca: ReturnType<typeof createAlpacaProviders>,
    symbol: string,
    confidence: number,
    account: Account
  ): Promise<boolean> {
    const sizePct = this.state.config.position_size_pct_of_cash;
    const positionSize = Math.min(
      account.cash * (sizePct / 100) * confidence,
      this.state.config.max_position_value
    );
    
    if (positionSize < 100) {
      this.log("Executor", "buy_skipped", { symbol, reason: "Position too small" });
      return false;
    }
    
    try {
      const order = await alpaca.trading.createOrder({
        symbol,
        notional: Math.round(positionSize * 100) / 100,
        side: "buy",
        type: "market",
        time_in_force: "day",
      });
      
      this.log("Executor", "buy_executed", { symbol, status: order.status, size: positionSize });
      return true;
    } catch (error) {
      this.log("Executor", "buy_failed", { symbol, error: String(error) });
      return false;
    }
  }

  private async executeSell(
    alpaca: ReturnType<typeof createAlpacaProviders>,
    symbol: string,
    reason: string
  ): Promise<boolean> {
    try {
      await alpaca.trading.closePosition(symbol);
      this.log("Executor", "sell_executed", { symbol, reason });
      return true;
    } catch (error) {
      this.log("Executor", "sell_failed", { symbol, error: String(error) });
      return false;
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private log(agent: string, action: string, details: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      agent,
      action,
      ...details,
    };
    this.state.logs.push(entry);
    
    // Keep last 500 logs
    if (this.state.logs.length > 500) {
      this.state.logs = this.state.logs.slice(-500);
    }
    
    // Log to console for wrangler tail
    console.log(`[${entry.timestamp}] [${agent}] ${action}`, JSON.stringify(details));
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  private jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Helper to get the DO stub
// ============================================================================

export function getTradingAgentStub(env: Env): DurableObjectStub {
  // Single global instance - use a fixed ID
  const id = env.TRADING_AGENT.idFromName("main");
  return env.TRADING_AGENT.get(id);
}

export async function getTradingAgentStatus(env: Env): Promise<unknown> {
  const stub = getTradingAgentStub(env);
  const response = await stub.fetch(new Request("http://agent/status"));
  return response.json();
}

export async function enableTradingAgent(env: Env): Promise<void> {
  const stub = getTradingAgentStub(env);
  await stub.fetch(new Request("http://agent/enable"));
}

export async function disableTradingAgent(env: Env): Promise<void> {
  const stub = getTradingAgentStub(env);
  await stub.fetch(new Request("http://agent/disable"));
}
