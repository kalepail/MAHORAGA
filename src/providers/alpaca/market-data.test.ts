import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlpacaClient } from "./client";
import { AlpacaMarketDataProvider, createAlpacaMarketDataProvider } from "./market-data";

describe("Alpaca Market Data Provider", () => {
  let mockClient: {
    tradingRequest: ReturnType<typeof vi.fn>;
    dataRequest: ReturnType<typeof vi.fn>;
  };
  let provider: AlpacaMarketDataProvider;

  const mockBar = {
    t: "2024-01-15T10:00:00Z",
    o: 150.0,
    h: 152.0,
    l: 149.5,
    c: 151.5,
    v: 1000000,
    n: 5000,
    vw: 151.0,
  };

  const mockQuote = {
    ap: 151.55,
    as: 100,
    bp: 151.5,
    bs: 200,
    t: "2024-01-15T10:00:00Z",
  };

  beforeEach(() => {
    mockClient = {
      tradingRequest: vi.fn(),
      dataRequest: vi.fn(),
    };
    provider = createAlpacaMarketDataProvider(mockClient as unknown as AlpacaClient);
  });

  describe("createAlpacaMarketDataProvider", () => {
    it("creates provider with client", () => {
      expect(provider).toBeInstanceOf(AlpacaMarketDataProvider);
    });
  });

  describe("getBars", () => {
    it("fetches and parses bars for symbol", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        bars: { AAPL: [mockBar] },
      });

      const bars = await provider.getBars("AAPL", "1Day");

      expect(mockClient.dataRequest).toHaveBeenCalledWith(
        "GET",
        "/v2/stocks/AAPL/bars",
        expect.objectContaining({ timeframe: "1Day" })
      );
      expect(bars).toHaveLength(1);
      expect(bars[0]!.o).toBe(150.0);
      expect(bars[0]!.h).toBe(152.0);
      expect(bars[0]!.l).toBe(149.5);
      expect(bars[0]!.c).toBe(151.5);
      expect(bars[0]!.v).toBe(1000000);
    });

    it("handles array response format", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        bars: [mockBar],
      });

      const bars = await provider.getBars("AAPL", "1Day");

      expect(bars).toHaveLength(1);
      expect(bars[0]!.c).toBe(151.5);
    });

    it("returns empty array when no bars", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        bars: {},
      });

      const bars = await provider.getBars("AAPL", "1Day");

      expect(bars).toEqual([]);
    });

    it("returns empty array when response is null", async () => {
      mockClient.dataRequest.mockResolvedValueOnce(null);

      const bars = await provider.getBars("AAPL", "1Day");

      expect(bars).toEqual([]);
    });

    it("passes optional params", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({ bars: {} });

      await provider.getBars("AAPL", "1Hour", {
        start: "2024-01-01",
        end: "2024-01-15",
        limit: 100,
        adjustment: "all",
        feed: "iex",
      });

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v2/stocks/AAPL/bars", {
        timeframe: "1Hour",
        start: "2024-01-01",
        end: "2024-01-15",
        limit: 100,
        adjustment: "all",
        feed: "iex",
      });
    });

    it("encodes symbol in URL", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({ bars: {} });

      await provider.getBars("BTC/USD", "1Day");

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v2/stocks/BTC%2FUSD/bars", expect.any(Object));
    });
  });

  describe("getLatestBar", () => {
    it("fetches latest bar for symbol", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        bars: { AAPL: mockBar },
      });

      const bar = await provider.getLatestBar("AAPL");

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v2/stocks/AAPL/bars/latest");
      expect(bar.c).toBe(151.5);
    });

    it("throws when no bar data available", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        bars: {},
      });

      await expect(provider.getLatestBar("AAPL")).rejects.toThrow("No bar data for AAPL");
    });
  });

  describe("getLatestBars", () => {
    it("fetches latest bars for multiple symbols", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        bars: {
          AAPL: mockBar,
          GOOGL: { ...mockBar, c: 140.0 },
        },
      });

      const bars = await provider.getLatestBars(["AAPL", "GOOGL"]);

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v2/stocks/bars/latest", { symbols: "AAPL,GOOGL" });
      expect(bars.AAPL!.c).toBe(151.5);
      expect(bars.GOOGL!.c).toBe(140.0);
    });
  });

  describe("getQuote", () => {
    it("fetches latest quote for symbol", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        quotes: { AAPL: mockQuote },
      });

      const quote = await provider.getQuote("AAPL");

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v2/stocks/AAPL/quotes/latest");
      expect(quote.symbol).toBe("AAPL");
      expect(quote.bid_price).toBe(151.5);
      expect(quote.ask_price).toBe(151.55);
      expect(quote.bid_size).toBe(200);
      expect(quote.ask_size).toBe(100);
    });

    it("throws when no quote data available", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        quotes: {},
      });

      await expect(provider.getQuote("AAPL")).rejects.toThrow("No quote data for AAPL");
    });
  });

  describe("getQuotes", () => {
    it("fetches latest quotes for multiple symbols", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        quotes: {
          AAPL: mockQuote,
          GOOGL: { ...mockQuote, bp: 140.0 },
        },
      });

      const quotes = await provider.getQuotes(["AAPL", "GOOGL"]);

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v2/stocks/quotes/latest", { symbols: "AAPL,GOOGL" });
      expect(quotes.AAPL!.bid_price).toBe(151.5);
      expect(quotes.GOOGL!.bid_price).toBe(140.0);
    });
  });

  describe("getSnapshot", () => {
    const mockSnapshot = {
      latestTrade: { p: 151.5, s: 100, t: "2024-01-15T10:00:00Z" },
      latestQuote: mockQuote,
      minuteBar: mockBar,
      dailyBar: mockBar,
      prevDailyBar: { ...mockBar, c: 150.0 },
    };

    it("fetches snapshot for symbol (direct response format)", async () => {
      mockClient.dataRequest.mockResolvedValueOnce(mockSnapshot);

      const snapshot = await provider.getSnapshot("AAPL");

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v2/stocks/AAPL/snapshot");
      expect(snapshot.symbol).toBe("AAPL");
      expect(snapshot.latest_trade.price).toBe(151.5);
      expect(snapshot.latest_quote.bid_price).toBe(151.5);
      expect(snapshot.minute_bar.c).toBe(151.5);
      expect(snapshot.daily_bar.c).toBe(151.5);
      expect(snapshot.prev_daily_bar.c).toBe(150.0);
    });

    it("fetches snapshot for symbol (keyed response format)", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        AAPL: mockSnapshot,
      });

      const snapshot = await provider.getSnapshot("AAPL");

      expect(snapshot.symbol).toBe("AAPL");
      expect(snapshot.latest_trade.price).toBe(151.5);
    });

    it("throws when response is null", async () => {
      mockClient.dataRequest.mockResolvedValueOnce(null);

      await expect(provider.getSnapshot("AAPL")).rejects.toThrow("No snapshot data for AAPL");
    });

    it("throws when symbol not in keyed response", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        GOOGL: mockSnapshot,
      });

      await expect(provider.getSnapshot("AAPL")).rejects.toThrow("No snapshot data for AAPL");
    });
  });

  describe("getCryptoSnapshot", () => {
    const mockCryptoSnapshot = {
      latestTrade: { p: 45000.0, s: 0.5, t: "2024-01-15T10:00:00Z" },
      latestQuote: { ...mockQuote, bp: 44999, ap: 45001 },
      minuteBar: { ...mockBar, c: 45000 },
      dailyBar: { ...mockBar, c: 45000 },
      prevDailyBar: { ...mockBar, c: 44500 },
    };

    it("fetches crypto snapshot", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        snapshots: { "BTC/USD": mockCryptoSnapshot },
      });

      const snapshot = await provider.getCryptoSnapshot("BTC/USD");

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v1beta3/crypto/us/snapshots", {
        symbols: "BTC/USD",
      });
      expect(snapshot.symbol).toBe("BTC/USD");
      expect(snapshot.latest_trade.price).toBe(45000.0);
    });

    it("throws when no crypto snapshot data", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        snapshots: {},
      });

      await expect(provider.getCryptoSnapshot("BTC/USD")).rejects.toThrow("No crypto snapshot data for BTC/USD");
    });
  });

  describe("getSnapshots", () => {
    const mockSnapshot = {
      latestTrade: { p: 151.5, s: 100, t: "2024-01-15T10:00:00Z" },
      latestQuote: mockQuote,
      minuteBar: mockBar,
      dailyBar: mockBar,
      prevDailyBar: mockBar,
    };

    it("fetches snapshots for multiple symbols", async () => {
      mockClient.dataRequest.mockResolvedValueOnce({
        AAPL: mockSnapshot,
        GOOGL: { ...mockSnapshot, latestTrade: { p: 140.0, s: 50, t: "2024-01-15T10:00:00Z" } },
      });

      const snapshots = await provider.getSnapshots(["AAPL", "GOOGL"]);

      expect(mockClient.dataRequest).toHaveBeenCalledWith("GET", "/v2/stocks/snapshots", { symbols: "AAPL,GOOGL" });
      expect(snapshots.AAPL!.latest_trade.price).toBe(151.5);
      expect(snapshots.GOOGL!.latest_trade.price).toBe(140.0);
    });
  });
});
