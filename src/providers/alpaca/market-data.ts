import type { Bar, BarsParams, MarketDataProvider, Quote, Snapshot } from "../types";
import type { AlpacaClient } from "./client";

interface AlpacaBarsResponse {
  bars: Record<string, AlpacaBar[]>;
  next_page_token?: string;
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  vw: number;
}

interface AlpacaLatestBarsResponse {
  bars: Record<string, AlpacaBar>;
}

interface AlpacaQuotesResponse {
  quotes: Record<string, AlpacaQuote>;
}

interface AlpacaQuote {
  ap: number;
  as: number;
  bp: number;
  bs: number;
  t: string;
}

interface AlpacaSnapshotsResponse {
  [symbol: string]: AlpacaSnapshot;
}

interface AlpacaSnapshot {
  latestTrade: {
    p: number;
    s: number;
    t: string;
  };
  latestQuote: AlpacaQuote;
  minuteBar: AlpacaBar;
  dailyBar: AlpacaBar;
  prevDailyBar: AlpacaBar;
}

function parseBar(raw: AlpacaBar): Bar {
  return {
    t: raw.t,
    o: raw.o,
    h: raw.h,
    l: raw.l,
    c: raw.c,
    v: raw.v,
    n: raw.n,
    vw: raw.vw,
  };
}

function parseQuote(symbol: string, raw: AlpacaQuote): Quote {
  return {
    symbol,
    bid_price: raw.bp,
    bid_size: raw.bs,
    ask_price: raw.ap,
    ask_size: raw.as,
    timestamp: raw.t,
  };
}

function parseSnapshot(symbol: string, raw: AlpacaSnapshot): Snapshot {
  return {
    symbol,
    latest_trade: {
      price: raw.latestTrade.p,
      size: raw.latestTrade.s,
      timestamp: raw.latestTrade.t,
    },
    latest_quote: parseQuote(symbol, raw.latestQuote),
    minute_bar: parseBar(raw.minuteBar),
    daily_bar: parseBar(raw.dailyBar),
    prev_daily_bar: parseBar(raw.prevDailyBar),
  };
}

export class AlpacaMarketDataProvider implements MarketDataProvider {
  constructor(private client: AlpacaClient) {}

  async getBars(symbol: string, timeframe: string, params?: BarsParams): Promise<Bar[]> {
    const response = await this.client.dataRequest<AlpacaBarsResponse | { bars: AlpacaBar[] }>(
      "GET",
      `/v2/stocks/${encodeURIComponent(symbol)}/bars`,
      {
        timeframe,
        start: params?.start,
        end: params?.end,
        limit: params?.limit,
        adjustment: params?.adjustment,
        feed: params?.feed,
      }
    );

    if (!response || !response.bars) {
      return [];
    }

    if (Array.isArray(response.bars)) {
      return response.bars.map(parseBar);
    }

    const bars = (response as AlpacaBarsResponse).bars[symbol];
    return bars ? bars.map(parseBar) : [];
  }

  async getLatestBar(symbol: string): Promise<Bar> {
    const response = await this.client.dataRequest<AlpacaLatestBarsResponse>(
      "GET",
      `/v2/stocks/${encodeURIComponent(symbol)}/bars/latest`
    );

    const bar = response.bars[symbol];
    if (!bar) {
      throw new Error(`No bar data for ${symbol}`);
    }
    return parseBar(bar);
  }

  async getLatestBars(symbols: string[]): Promise<Record<string, Bar>> {
    const response = await this.client.dataRequest<AlpacaLatestBarsResponse>("GET", "/v2/stocks/bars/latest", {
      symbols: symbols.join(","),
    });

    const result: Record<string, Bar> = {};
    for (const [symbol, bar] of Object.entries(response.bars)) {
      result[symbol] = parseBar(bar);
    }
    return result;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const response = await this.client.dataRequest<AlpacaQuotesResponse>(
      "GET",
      `/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`
    );

    const quote = response.quotes[symbol];
    if (!quote) {
      throw new Error(`No quote data for ${symbol}`);
    }
    return parseQuote(symbol, quote);
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    const response = await this.client.dataRequest<AlpacaQuotesResponse>("GET", "/v2/stocks/quotes/latest", {
      symbols: symbols.join(","),
    });

    const result: Record<string, Quote> = {};
    for (const [symbol, quote] of Object.entries(response.quotes)) {
      result[symbol] = parseQuote(symbol, quote);
    }
    return result;
  }

  async getSnapshot(symbol: string): Promise<Snapshot> {
    const response = await this.client.dataRequest<AlpacaSnapshotsResponse | AlpacaSnapshot>(
      "GET",
      `/v2/stocks/${encodeURIComponent(symbol)}/snapshot`
    );

    if (!response) {
      throw new Error(`No snapshot data for ${symbol} (market may be closed)`);
    }

    if ("latestTrade" in response) {
      return parseSnapshot(symbol, response as AlpacaSnapshot);
    }

    const snapshot = (response as AlpacaSnapshotsResponse)[symbol];
    if (!snapshot) {
      throw new Error(`No snapshot data for ${symbol} (market may be closed)`);
    }
    return parseSnapshot(symbol, snapshot);
  }

  async getCryptoSnapshot(symbol: string): Promise<Snapshot> {
    const response = await this.client.dataRequest<{ snapshots: AlpacaSnapshotsResponse }>(
      "GET",
      "/v1beta3/crypto/us/snapshots",
      { symbols: symbol }
    );

    const snapshot = response.snapshots?.[symbol as keyof typeof response.snapshots];
    if (!snapshot) {
      throw new Error(`No crypto snapshot data for ${symbol}`);
    }
    return parseSnapshot(symbol, snapshot);
  }

  async getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
    const response = await this.client.dataRequest<AlpacaSnapshotsResponse>("GET", "/v2/stocks/snapshots", {
      symbols: symbols.join(","),
    });

    const result: Record<string, Snapshot> = {};
    for (const [symbol, snapshot] of Object.entries(response)) {
      result[symbol] = parseSnapshot(symbol, snapshot);
    }
    return result;
  }
}

export function createAlpacaMarketDataProvider(client: AlpacaClient): AlpacaMarketDataProvider {
  return new AlpacaMarketDataProvider(client);
}
