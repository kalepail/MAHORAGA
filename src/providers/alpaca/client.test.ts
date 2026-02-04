import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../../lib/errors";
import { AlpacaClient, createAlpacaClient } from "./client";

describe("Alpaca Client", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  const validConfig = {
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    paper: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("createAlpacaClient", () => {
    it("creates client with paper trading config", () => {
      const client = createAlpacaClient(validConfig);
      expect(client).toBeInstanceOf(AlpacaClient);
    });

    it("creates client with live trading config", () => {
      const client = createAlpacaClient({ ...validConfig, paper: false });
      expect(client).toBeInstanceOf(AlpacaClient);
    });
  });

  describe("tradingRequest", () => {
    it("uses paper trading URL when paper is true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: "success" }),
      });

      const client = createAlpacaClient(validConfig);
      await client.tradingRequest("GET", "/v2/account");

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://paper-api.alpaca.markets/v2/account");
    });

    it("uses live trading URL when paper is false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: "success" }),
      });

      const client = createAlpacaClient({ ...validConfig, paper: false });
      await client.tradingRequest("GET", "/v2/account");

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://api.alpaca.markets/v2/account");
    });

    it("sends correct auth headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createAlpacaClient(validConfig);
      await client.tradingRequest("GET", "/v2/account");

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[1].headers).toMatchObject({
        "APCA-API-KEY-ID": "test-api-key",
        "APCA-API-SECRET-KEY": "test-api-secret",
        "Content-Type": "application/json",
      });
    });

    it("sends body as JSON for POST requests", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "order-123" }),
      });

      const client = createAlpacaClient(validConfig);
      await client.tradingRequest("POST", "/v2/orders", {
        symbol: "AAPL",
        qty: "10",
        side: "buy",
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body as string)).toEqual({
        symbol: "AAPL",
        qty: "10",
        side: "buy",
      });
    });

    it("returns undefined for 204 No Content response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      const client = createAlpacaClient(validConfig);
      const result = await client.tradingRequest("DELETE", "/v2/orders/123");

      expect(result).toBeUndefined();
    });

    it("throws UNAUTHORIZED on 401 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "Invalid credentials" }),
      });

      const client = createAlpacaClient(validConfig);

      await expect(client.tradingRequest("GET", "/v2/account")).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
        message: expect.stringContaining("Invalid credentials"),
      });
    });

    it("throws FORBIDDEN on 403 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ message: "Access denied" }),
      });

      const client = createAlpacaClient(validConfig);

      await expect(client.tradingRequest("GET", "/v2/account")).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        message: expect.stringContaining("Access denied"),
      });
    });

    it("throws NOT_FOUND on 404 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: "Order not found" }),
      });

      const client = createAlpacaClient(validConfig);

      await expect(client.tradingRequest("GET", "/v2/orders/nonexistent")).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: expect.stringContaining("Order not found"),
      });
    });

    it("throws INVALID_INPUT on 422 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ message: "Invalid quantity" }),
      });

      const client = createAlpacaClient(validConfig);

      await expect(client.tradingRequest("POST", "/v2/orders", { qty: -1 })).rejects.toMatchObject({
        code: ErrorCode.INVALID_INPUT,
        message: expect.stringContaining("Invalid quantity"),
      });
    });

    it("throws RATE_LIMITED on 429 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ message: "Too many requests" }),
      });

      const client = createAlpacaClient(validConfig);

      await expect(client.tradingRequest("GET", "/v2/account")).rejects.toMatchObject({
        code: ErrorCode.RATE_LIMITED,
        message: expect.stringContaining("Too many requests"),
      });
    });

    it("throws PROVIDER_ERROR on 500 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const client = createAlpacaClient(validConfig);

      await expect(client.tradingRequest("GET", "/v2/account")).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ERROR,
        message: expect.stringContaining("500"),
      });
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      });

      const client = createAlpacaClient(validConfig);

      await expect(client.tradingRequest("GET", "/v2/account")).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ERROR,
        message: expect.stringContaining("Service Unavailable"),
      });
    });
  });

  describe("dataRequest", () => {
    it("uses data API URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ bars: {} }),
      });

      const client = createAlpacaClient(validConfig);
      await client.dataRequest("GET", "/v2/stocks/AAPL/bars");

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toContain("https://data.alpaca.markets/v2/stocks/AAPL/bars");
    });

    it("appends query params to URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ bars: {} }),
      });

      const client = createAlpacaClient(validConfig);
      await client.dataRequest("GET", "/v2/stocks/AAPL/bars", {
        timeframe: "1Day",
        limit: 100,
        start: "2024-01-01",
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const url = new URL(call[0]);
      expect(url.searchParams.get("timeframe")).toBe("1Day");
      expect(url.searchParams.get("limit")).toBe("100");
      expect(url.searchParams.get("start")).toBe("2024-01-01");
    });

    it("skips undefined params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ bars: {} }),
      });

      const client = createAlpacaClient(validConfig);
      await client.dataRequest("GET", "/v2/stocks/AAPL/bars", {
        timeframe: "1Day",
        limit: undefined,
        end: undefined,
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const url = new URL(call[0]);
      expect(url.searchParams.get("timeframe")).toBe("1Day");
      expect(url.searchParams.has("limit")).toBe(false);
      expect(url.searchParams.has("end")).toBe(false);
    });

    it("sends correct auth headers for data requests", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = createAlpacaClient(validConfig);
      await client.dataRequest("GET", "/v2/stocks/AAPL/bars");

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[1].headers).toMatchObject({
        "APCA-API-KEY-ID": "test-api-key",
        "APCA-API-SECRET-KEY": "test-api-secret",
      });
    });
  });
});
