import type { Env } from "../env.d";
import { parseNumber } from "../lib/utils";

export type OptionsStrategy = "long_call" | "long_put";

export interface OptionsPolicyConfig {
  /** Enable options trading (default: false) */
  options_enabled: boolean;
  /** Maximum % of account per single options trade (default: 2%) */
  max_pct_per_option_trade: number;
  /** Maximum total options exposure as % of equity (default: 10%) */
  max_total_options_exposure_pct: number;
  /** Minimum days to expiration (default: 30 - no weeklies) */
  min_dte: number;
  /** Maximum days to expiration (default: 60) */
  max_dte: number;
  /** Minimum delta for option selection (default: 0.30) */
  min_delta: number;
  /** Maximum delta for option selection (default: 0.70) */
  max_delta: number;
  /** Allowed strategies (default: long_call, long_put only) */
  allowed_strategies: OptionsStrategy[];
  /** Never average down on losing options (default: true) */
  no_averaging_down: boolean;
  /** Maximum number of option positions (default: 3) */
  max_option_positions: number;
  /** Minimum confidence to trade options (default: 0.8) */
  min_confidence_for_options: number;
}

export interface PolicyConfig {
  max_position_pct_equity: number;
  max_open_positions: number;
  max_notional_per_trade: number;
  allowed_order_types: string[];
  max_daily_loss_pct: number;
  cooldown_minutes_after_loss: number;
  allowed_symbols: string[] | null;
  deny_symbols: string[];
  min_avg_volume: number;
  min_price: number;
  trading_hours_only: boolean;
  extended_hours_allowed: boolean;
  approval_token_ttl_seconds: number;
  allow_short_selling: boolean;
  use_cash_only: boolean;
  /** Options-specific policy configuration */
  options: OptionsPolicyConfig;
}

export function getDefaultOptionsPolicyConfig(): OptionsPolicyConfig {
  return {
    options_enabled: false,
    max_pct_per_option_trade: 0.02,
    max_total_options_exposure_pct: 0.1,
    min_dte: 30,
    max_dte: 60,
    min_delta: 0.3,
    max_delta: 0.7,
    allowed_strategies: ["long_call", "long_put"],
    no_averaging_down: true,
    max_option_positions: 3,
    min_confidence_for_options: 0.8,
  };
}

export function getDefaultPolicyConfig(env: Env): PolicyConfig {
  return {
    max_position_pct_equity: parseNumber(env.DEFAULT_MAX_POSITION_PCT, 0.1),
    max_open_positions: parseNumber(env.DEFAULT_MAX_OPEN_POSITIONS, 10),
    max_notional_per_trade: parseNumber(env.DEFAULT_MAX_NOTIONAL_PER_TRADE, 5000),
    allowed_order_types: ["market", "limit", "stop", "stop_limit"],
    max_daily_loss_pct: parseNumber(env.DEFAULT_MAX_DAILY_LOSS_PCT, 0.02),
    cooldown_minutes_after_loss: parseNumber(env.DEFAULT_COOLDOWN_MINUTES, 30),
    allowed_symbols: null,
    deny_symbols: [],
    min_avg_volume: 100000,
    min_price: 1.0,
    trading_hours_only: true,
    extended_hours_allowed: false,
    approval_token_ttl_seconds: parseNumber(env.DEFAULT_APPROVAL_TTL_SECONDS, 300),
    allow_short_selling: false,
    use_cash_only: true,
    options: getDefaultOptionsPolicyConfig(),
  };
}

export function validateOptionsPolicyConfig(config: unknown): OptionsPolicyConfig {
  const c = config as Record<string, unknown>;

  if (typeof c.options_enabled !== "boolean") {
    throw new Error("options.options_enabled must be a boolean");
  }

  if (
    typeof c.max_pct_per_option_trade !== "number" ||
    c.max_pct_per_option_trade <= 0 ||
    c.max_pct_per_option_trade > 0.1
  ) {
    throw new Error("options.max_pct_per_option_trade must be between 0 and 0.1 (10%)");
  }

  if (
    typeof c.max_total_options_exposure_pct !== "number" ||
    c.max_total_options_exposure_pct <= 0 ||
    c.max_total_options_exposure_pct > 0.25
  ) {
    throw new Error("options.max_total_options_exposure_pct must be between 0 and 0.25 (25%)");
  }

  if (typeof c.min_dte !== "number" || c.min_dte < 7) {
    throw new Error("options.min_dte must be at least 7 days");
  }

  if (typeof c.max_dte !== "number" || c.max_dte <= c.min_dte) {
    throw new Error("options.max_dte must be greater than min_dte");
  }

  if (typeof c.min_delta !== "number" || c.min_delta < 0.1 || c.min_delta > 0.5) {
    throw new Error("options.min_delta must be between 0.1 and 0.5");
  }

  if (typeof c.max_delta !== "number" || c.max_delta < 0.3 || c.max_delta > 0.9) {
    throw new Error("options.max_delta must be between 0.3 and 0.9");
  }

  if (c.max_delta <= c.min_delta) {
    throw new Error("options.max_delta must be greater than min_delta");
  }

  const validStrategies: OptionsStrategy[] = ["long_call", "long_put"];
  if (!Array.isArray(c.allowed_strategies) || c.allowed_strategies.length === 0) {
    throw new Error("options.allowed_strategies must be a non-empty array");
  }
  for (const s of c.allowed_strategies as string[]) {
    if (!validStrategies.includes(s as OptionsStrategy)) {
      throw new Error(`options.allowed_strategies contains invalid strategy: ${s}`);
    }
  }

  if (typeof c.max_option_positions !== "number" || c.max_option_positions < 1 || c.max_option_positions > 10) {
    throw new Error("options.max_option_positions must be between 1 and 10");
  }

  if (
    typeof c.min_confidence_for_options !== "number" ||
    c.min_confidence_for_options < 0.5 ||
    c.min_confidence_for_options > 1
  ) {
    throw new Error("options.min_confidence_for_options must be between 0.5 and 1");
  }

  return config as OptionsPolicyConfig;
}

export function validatePolicyConfig(config: unknown): PolicyConfig {
  const c = config as Record<string, unknown>;

  if (
    typeof c.max_position_pct_equity !== "number" ||
    c.max_position_pct_equity <= 0 ||
    c.max_position_pct_equity > 1
  ) {
    throw new Error("max_position_pct_equity must be between 0 and 1");
  }

  if (typeof c.max_open_positions !== "number" || c.max_open_positions < 1) {
    throw new Error("max_open_positions must be at least 1");
  }

  if (typeof c.max_notional_per_trade !== "number" || c.max_notional_per_trade <= 0) {
    throw new Error("max_notional_per_trade must be positive");
  }

  if (!Array.isArray(c.allowed_order_types) || c.allowed_order_types.length === 0) {
    throw new Error("allowed_order_types must be a non-empty array");
  }

  if (typeof c.max_daily_loss_pct !== "number" || c.max_daily_loss_pct <= 0 || c.max_daily_loss_pct > 1) {
    throw new Error("max_daily_loss_pct must be between 0 and 1");
  }

  if (typeof c.cooldown_minutes_after_loss !== "number" || c.cooldown_minutes_after_loss < 0) {
    throw new Error("cooldown_minutes_after_loss must be non-negative");
  }

  if (typeof c.approval_token_ttl_seconds !== "number" || c.approval_token_ttl_seconds < 60) {
    throw new Error("approval_token_ttl_seconds must be at least 60");
  }

  if (c.options) {
    validateOptionsPolicyConfig(c.options);
  }

  return config as PolicyConfig;
}
