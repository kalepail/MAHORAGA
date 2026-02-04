import { beforeEach, describe, expect, it } from "vitest";
import type { OrderPreview } from "../mcp/types";
import type { Account, MarketClock, Position } from "../providers/types";
import type { RiskState } from "../storage/d1/queries/risk-state";
import { getDefaultOptionsPolicyConfig, type PolicyConfig } from "./config";
import { type PolicyContext, PolicyEngine } from "./engine";

function createTestConfig(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    max_position_pct_equity: 0.1,
    max_open_positions: 5,
    max_notional_per_trade: 5000,
    allowed_order_types: ["market", "limit"],
    max_daily_loss_pct: 0.02,
    cooldown_minutes_after_loss: 30,
    allowed_symbols: null,
    deny_symbols: [],
    min_avg_volume: 100000,
    min_price: 1.0,
    trading_hours_only: true,
    extended_hours_allowed: false,
    approval_token_ttl_seconds: 300,
    allow_short_selling: false,
    use_cash_only: true,
    options: getDefaultOptionsPolicyConfig(),
    ...overrides,
  };
}

function createTestOrder(overrides: Partial<OrderPreview> = {}): OrderPreview {
  return {
    symbol: "AAPL",
    side: "buy",
    order_type: "market",
    qty: 10,
    estimated_price: 150,
    notional: 1500,
    asset_class: "us_equity",
    time_in_force: "day",
    ...overrides,
  };
}

function createTestAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "test-account",
    account_number: "12345",
    status: "ACTIVE",
    currency: "USD",
    cash: 50000,
    buying_power: 100000,
    regt_buying_power: 100000,
    daytrading_buying_power: 0,
    equity: 100000,
    last_equity: 100000,
    long_market_value: 50000,
    short_market_value: 0,
    portfolio_value: 100000,
    pattern_day_trader: false,
    trading_blocked: false,
    transfers_blocked: false,
    account_blocked: false,
    multiplier: "1",
    shorting_enabled: false,
    maintenance_margin: 0,
    initial_margin: 0,
    daytrade_count: 0,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function createTestClock(overrides: Partial<MarketClock> = {}): MarketClock {
  return {
    timestamp: new Date().toISOString(),
    is_open: true,
    next_open: "2024-01-02T09:30:00Z",
    next_close: "2024-01-02T16:00:00Z",
    ...overrides,
  };
}

function createTestRiskState(overrides: Partial<RiskState> = {}): RiskState {
  return {
    kill_switch_active: false,
    kill_switch_reason: null,
    kill_switch_at: null,
    daily_loss_usd: 0,
    daily_loss_reset_at: new Date().toISOString(),
    last_loss_at: null,
    cooldown_until: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createTestPosition(overrides: Partial<Position> = {}): Position {
  return {
    asset_id: "test-asset",
    symbol: "AAPL",
    exchange: "NASDAQ",
    asset_class: "us_equity",
    avg_entry_price: 150,
    qty: 10,
    side: "long",
    market_value: 1500,
    cost_basis: 1500,
    unrealized_pl: 0,
    unrealized_plpc: 0,
    unrealized_intraday_pl: 0,
    unrealized_intraday_plpc: 0,
    current_price: 150,
    lastday_price: 150,
    change_today: 0,
    ...overrides,
  };
}

function createTestContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    order: createTestOrder(),
    account: createTestAccount(),
    positions: [],
    clock: createTestClock(),
    riskState: createTestRiskState(),
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine(createTestConfig());
  });

  describe("kill switch", () => {
    it("blocks trades when kill switch is active", () => {
      const ctx = createTestContext({
        riskState: createTestRiskState({
          kill_switch_active: true,
          kill_switch_reason: "Manual halt",
        }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.rule).toBe("kill_switch");
    });

    it("allows trades when kill switch is inactive", () => {
      const ctx = createTestContext();
      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(true);
    });
  });

  describe("cooldown period", () => {
    it("blocks trades during cooldown period", () => {
      const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const ctx = createTestContext({
        riskState: createTestRiskState({
          cooldown_until: futureTime,
        }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "loss_cooldown")).toBe(true);
    });

    it("allows trades after cooldown expires", () => {
      const pastTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const ctx = createTestContext({
        riskState: createTestRiskState({
          cooldown_until: pastTime,
        }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(true);
    });
  });

  describe("daily loss limit", () => {
    it("blocks trades when daily loss limit reached", () => {
      const ctx = createTestContext({
        riskState: createTestRiskState({
          daily_loss_usd: 2500,
        }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "daily_loss_limit")).toBe(true);
    });

    it("allows trades below daily loss limit", () => {
      const ctx = createTestContext({
        riskState: createTestRiskState({
          daily_loss_usd: 1000,
        }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(true);
    });
  });

  describe("trading hours", () => {
    it("blocks trades outside market hours when trading_hours_only is true", () => {
      const ctx = createTestContext({
        clock: createTestClock({ is_open: false }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "trading_hours")).toBe(true);
    });

    it("allows crypto trades outside market hours", () => {
      const ctx = createTestContext({
        order: createTestOrder({
          symbol: "BTC/USD",
          asset_class: "crypto",
          time_in_force: "gtc",
        }),
        clock: createTestClock({ is_open: false }),
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "trading_hours")).toBe(false);
    });

    it("adds warning for extended hours trading when allowed", () => {
      engine = new PolicyEngine(createTestConfig({ extended_hours_allowed: true }));
      const ctx = createTestContext({
        clock: createTestClock({ is_open: false }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(true);
      expect(result.warnings.some((w) => w.rule === "extended_hours")).toBe(true);
    });
  });

  describe("symbol filters", () => {
    it("blocks denied symbols", () => {
      engine = new PolicyEngine(createTestConfig({ deny_symbols: ["AAPL", "GOOG"] }));
      const ctx = createTestContext();

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "symbol_denied")).toBe(true);
    });

    it("blocks symbols not in allow list when allow list is set", () => {
      engine = new PolicyEngine(createTestConfig({ allowed_symbols: ["GOOG", "MSFT"] }));
      const ctx = createTestContext();

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "symbol_not_allowed")).toBe(true);
    });

    it("allows symbols in allow list", () => {
      engine = new PolicyEngine(createTestConfig({ allowed_symbols: ["AAPL", "GOOG"] }));
      const ctx = createTestContext();

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "symbol_not_allowed")).toBe(false);
    });

    it("is case-insensitive for symbol matching", () => {
      engine = new PolicyEngine(createTestConfig({ deny_symbols: ["aapl"] }));
      const ctx = createTestContext({
        order: createTestOrder({ symbol: "AAPL" }),
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "symbol_denied")).toBe(true);
    });
  });

  describe("order type restrictions", () => {
    it("blocks disallowed order types", () => {
      const ctx = createTestContext({
        order: createTestOrder({ order_type: "stop_limit" }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "order_type_not_allowed")).toBe(true);
    });

    it("allows configured order types", () => {
      const ctx = createTestContext({
        order: createTestOrder({ order_type: "limit" }),
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "order_type_not_allowed")).toBe(false);
    });
  });

  describe("notional limits", () => {
    it("blocks orders exceeding max notional", () => {
      const ctx = createTestContext({
        order: createTestOrder({ notional: 15000 }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "max_notional")).toBe(true);
    });

    it("allows orders within notional limit", () => {
      const ctx = createTestContext({
        order: createTestOrder({ notional: 4000 }),
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "max_notional")).toBe(false);
    });
  });

  describe("position size limits", () => {
    it("blocks buy orders that would exceed position % of equity", () => {
      const ctx = createTestContext({
        order: createTestOrder({ notional: 15000 }),
        account: createTestAccount({ equity: 50000 }),
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "max_position_pct")).toBe(true);
    });

    it("includes existing position value in calculation", () => {
      const ctx = createTestContext({
        order: createTestOrder({ notional: 4000 }),
        account: createTestAccount({ equity: 50000 }),
        positions: [createTestPosition({ symbol: "AAPL", market_value: 3000 })],
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "max_position_pct")).toBe(true);
    });

    it("adds warning when approaching position size limit", () => {
      engine = new PolicyEngine(createTestConfig({ max_position_pct_equity: 0.1 }));
      const ctx = createTestContext({
        order: createTestOrder({ notional: 4500 }),
        account: createTestAccount({ equity: 50000 }),
      });

      const result = engine.evaluate(ctx);
      expect(result.warnings.some((w) => w.rule === "position_size_warning")).toBe(true);
    });
  });

  describe("open positions limit", () => {
    it("blocks new positions when at max", () => {
      const ctx = createTestContext({
        positions: [
          createTestPosition({ symbol: "GOOG" }),
          createTestPosition({ symbol: "MSFT" }),
          createTestPosition({ symbol: "AMZN" }),
          createTestPosition({ symbol: "META" }),
          createTestPosition({ symbol: "TSLA" }),
        ],
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "max_open_positions")).toBe(true);
    });

    it("allows adding to existing position at max positions", () => {
      const ctx = createTestContext({
        positions: [
          createTestPosition({ symbol: "AAPL" }),
          createTestPosition({ symbol: "GOOG" }),
          createTestPosition({ symbol: "MSFT" }),
          createTestPosition({ symbol: "AMZN" }),
          createTestPosition({ symbol: "META" }),
        ],
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "max_open_positions")).toBe(false);
    });
  });

  describe("short selling restrictions", () => {
    it("blocks short selling when disabled", () => {
      const ctx = createTestContext({
        order: createTestOrder({ side: "sell" }),
        positions: [],
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "short_selling_blocked")).toBe(true);
    });

    it("blocks selling more shares than owned", () => {
      const ctx = createTestContext({
        order: createTestOrder({ side: "sell", qty: 20 }),
        positions: [createTestPosition({ symbol: "AAPL", qty: 10 })],
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "short_selling_blocked")).toBe(true);
    });

    it("allows selling owned shares", () => {
      const ctx = createTestContext({
        order: createTestOrder({ side: "sell", qty: 10 }),
        positions: [createTestPosition({ symbol: "AAPL", qty: 10 })],
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "short_selling_blocked")).toBe(false);
    });

    it("allows short selling when enabled", () => {
      engine = new PolicyEngine(createTestConfig({ allow_short_selling: true }));
      const ctx = createTestContext({
        order: createTestOrder({ side: "sell" }),
        positions: [],
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "short_selling_blocked")).toBe(false);
    });
  });

  describe("buying power", () => {
    it("blocks orders exceeding available cash when use_cash_only is true", () => {
      const ctx = createTestContext({
        order: createTestOrder({ notional: 4500 }),
        account: createTestAccount({ cash: 1000, buying_power: 50000 }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.rule === "insufficient_funds")).toBe(true);
    });

    it("allows orders within buying power when use_cash_only is false", () => {
      engine = new PolicyEngine(createTestConfig({ use_cash_only: false }));
      const ctx = createTestContext({
        order: createTestOrder({ notional: 4500 }),
        account: createTestAccount({ cash: 1000, buying_power: 50000 }),
      });

      const result = engine.evaluate(ctx);
      expect(result.violations.some((v) => v.rule === "insufficient_funds")).toBe(false);
    });
  });

  describe("multiple violations", () => {
    it("collects all violations in a single evaluation", () => {
      engine = new PolicyEngine(createTestConfig({ deny_symbols: ["AAPL"] }));
      const ctx = createTestContext({
        order: createTestOrder({ order_type: "stop_limit", notional: 15000 }),
        riskState: createTestRiskState({ kill_switch_active: true }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(1);
    });
  });

  describe("edge cases", () => {
    it("handles zero equity without division error", () => {
      const ctx = createTestContext({
        account: createTestAccount({ equity: 0 }),
        riskState: createTestRiskState({ daily_loss_usd: 100 }),
      });

      expect(() => engine.evaluate(ctx)).not.toThrow();
    });

    it("handles notional calculation from qty when notional not provided", () => {
      const ctx = createTestContext({
        order: createTestOrder({
          notional: undefined,
          qty: 10,
          estimated_price: 150,
        }),
      });

      const result = engine.evaluate(ctx);
      expect(result.allowed).toBe(true);
    });
  });
});
