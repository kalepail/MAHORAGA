import type { Bar } from "./types";

export interface TechnicalIndicators {
  symbol: string;
  timestamp: string;
  price: number;
  sma_20: number | null;
  sma_50: number | null;
  sma_200: number | null;
  ema_12: number | null;
  ema_26: number | null;
  rsi_14: number | null;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  } | null;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    width: number;
  } | null;
  atr_14: number | null;
  volume_sma_20: number | null;
  relative_volume: number | null;
}

export interface Signal {
  type: string;
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
  description: string;
}

export function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i]! - ema) * multiplier + ema;
  }

  return ema;
}

export function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i]! - prices[i - 1]!);
  }

  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } | null {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  if (ema12 === null || ema26 === null) return null;

  const macdLine = ema12 - ema26;

  const macdValues: number[] = [];
  let tempEma12 = prices.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let tempEma26 = prices.slice(0, 26).reduce((a, b) => a + b, 0) / 26;

  for (let i = 26; i < prices.length; i++) {
    tempEma12 = (prices[i]! - tempEma12) * (2 / 13) + tempEma12;
    tempEma26 = (prices[i]! - tempEma26) * (2 / 27) + tempEma26;
    macdValues.push(tempEma12 - tempEma26);
  }

  if (macdValues.length < 9) return null;

  let signal = macdValues.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  for (let i = 9; i < macdValues.length; i++) {
    signal = (macdValues[i]! - signal) * (2 / 10) + signal;
  }

  return {
    macd: macdLine,
    signal,
    histogram: macdLine - signal,
  };
}

export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number; width: number } | null {
  if (prices.length < period) return null;

  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;

  const squaredDiffs = slice.map((p) => (p - middle) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(variance);

  const upper = middle + stdDev * std;
  const lower = middle - stdDev * std;

  return {
    upper,
    middle,
    lower,
    width: (upper - lower) / middle,
  };
}

export function calculateATR(bars: Bar[], period: number = 14): number | null {
  if (bars.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const current = bars[i]!;
    const prev = bars[i - 1]!;
    const tr = Math.max(current.h - current.l, Math.abs(current.h - prev.c), Math.abs(current.l - prev.c));
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }

  return atr;
}

export function computeTechnicals(symbol: string, bars: Bar[]): TechnicalIndicators {
  const closes = bars.map((b) => b.c);
  const volumes = bars.map((b) => b.v);
  const currentPrice = closes[closes.length - 1] ?? 0;
  const currentVolume = volumes[volumes.length - 1] ?? 0;

  const volumeSma = calculateSMA(volumes, 20);
  const relativeVolume = volumeSma && volumeSma > 0 ? currentVolume / volumeSma : null;

  return {
    symbol,
    timestamp: bars[bars.length - 1]?.t ?? new Date().toISOString(),
    price: currentPrice,
    sma_20: calculateSMA(closes, 20),
    sma_50: calculateSMA(closes, 50),
    sma_200: calculateSMA(closes, 200),
    ema_12: calculateEMA(closes, 12),
    ema_26: calculateEMA(closes, 26),
    rsi_14: calculateRSI(closes, 14),
    macd: calculateMACD(closes),
    bollinger: calculateBollingerBands(closes, 20, 2),
    atr_14: calculateATR(bars, 14),
    volume_sma_20: volumeSma,
    relative_volume: relativeVolume,
  };
}

export function detectSignals(technicals: TechnicalIndicators): Signal[] {
  const signals: Signal[] = [];

  if (technicals.rsi_14 !== null) {
    if (technicals.rsi_14 < 30) {
      signals.push({
        type: "rsi_oversold",
        direction: "bullish",
        strength: (30 - technicals.rsi_14) / 30,
        description: `RSI at ${technicals.rsi_14.toFixed(1)} - oversold territory`,
      });
    } else if (technicals.rsi_14 > 70) {
      signals.push({
        type: "rsi_overbought",
        direction: "bearish",
        strength: (technicals.rsi_14 - 70) / 30,
        description: `RSI at ${technicals.rsi_14.toFixed(1)} - overbought territory`,
      });
    }
  }

  if (technicals.macd !== null) {
    if (technicals.macd.histogram > 0 && technicals.macd.macd > technicals.macd.signal) {
      signals.push({
        type: "macd_bullish",
        direction: "bullish",
        strength: Math.min(1, Math.abs(technicals.macd.histogram) * 10),
        description: "MACD above signal line with positive histogram",
      });
    } else if (technicals.macd.histogram < 0 && technicals.macd.macd < technicals.macd.signal) {
      signals.push({
        type: "macd_bearish",
        direction: "bearish",
        strength: Math.min(1, Math.abs(technicals.macd.histogram) * 10),
        description: "MACD below signal line with negative histogram",
      });
    }
  }

  if (technicals.bollinger !== null) {
    const bbPosition =
      (technicals.price - technicals.bollinger.lower) / (technicals.bollinger.upper - technicals.bollinger.lower);

    if (bbPosition < 0.1) {
      signals.push({
        type: "bb_lower_touch",
        direction: "bullish",
        strength: 1 - bbPosition * 10,
        description: "Price near lower Bollinger Band",
      });
    } else if (bbPosition > 0.9) {
      signals.push({
        type: "bb_upper_touch",
        direction: "bearish",
        strength: (bbPosition - 0.9) * 10,
        description: "Price near upper Bollinger Band",
      });
    }
  }

  if (technicals.sma_20 !== null && technicals.sma_50 !== null) {
    const crossoverStrength = Math.abs(technicals.sma_20 - technicals.sma_50) / technicals.price;

    if (technicals.sma_20 > technicals.sma_50) {
      signals.push({
        type: "golden_cross_active",
        direction: "bullish",
        strength: Math.min(1, crossoverStrength * 20),
        description: "20 SMA above 50 SMA (bullish trend)",
      });
    } else {
      signals.push({
        type: "death_cross_active",
        direction: "bearish",
        strength: Math.min(1, crossoverStrength * 20),
        description: "20 SMA below 50 SMA (bearish trend)",
      });
    }
  }

  if (technicals.relative_volume !== null && technicals.relative_volume > 2) {
    signals.push({
      type: "high_volume",
      direction: "neutral",
      strength: Math.min(1, (technicals.relative_volume - 1) / 4),
      description: `Volume ${technicals.relative_volume.toFixed(1)}x average`,
    });
  }

  return signals;
}
