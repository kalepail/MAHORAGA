import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlpacaClient } from "./client";
import { AlpacaTradingProvider, createAlpacaTradingProvider } from "./trading";

describe("Alpaca Trading Provider", () => {
  let mockClient: {
    tradingRequest: ReturnType<typeof vi.fn>;
    dataRequest: ReturnType<typeof vi.fn>;
  };
  let provider: AlpacaTradingProvider;

  beforeEach(() => {
    mockClient = {
      tradingRequest: vi.fn(),
      dataRequest: vi.fn(),
    };
    provider = createAlpacaTradingProvider(mockClient as unknown as AlpacaClient);
  });

  describe("createAlpacaTradingProvider", () => {
    it("creates provider with client", () => {
      expect(provider).toBeInstanceOf(AlpacaTradingProvider);
    });
  });

  describe("getAccount", () => {
    it("fetches and parses account data", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "acc-123",
        account_number: "123456",
        status: "ACTIVE",
        currency: "USD",
        cash: "10000.50",
        buying_power: "20000.00",
        regt_buying_power: "15000.00",
        daytrading_buying_power: "40000.00",
        equity: "25000.00",
        last_equity: "24500.00",
        long_market_value: "15000.00",
        short_market_value: "0.00",
        portfolio_value: "25000.00",
        pattern_day_trader: false,
        trading_blocked: false,
        transfers_blocked: false,
        account_blocked: false,
        multiplier: "4",
        shorting_enabled: true,
        maintenance_margin: "5000.00",
        initial_margin: "7500.00",
        daytrade_count: 2,
        created_at: "2024-01-01T00:00:00Z",
      });

      const account = await provider.getAccount();

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/account");
      expect(account.id).toBe("acc-123");
      expect(account.cash).toBe(10000.5);
      expect(account.buying_power).toBe(20000);
      expect(account.equity).toBe(25000);
      expect(account.pattern_day_trader).toBe(false);
    });
  });

  describe("getPositions", () => {
    it("fetches and parses positions list", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce([
        {
          asset_id: "asset-1",
          symbol: "AAPL",
          exchange: "NASDAQ",
          asset_class: "us_equity",
          avg_entry_price: "150.00",
          qty: "10",
          side: "long",
          market_value: "1550.00",
          cost_basis: "1500.00",
          unrealized_pl: "50.00",
          unrealized_plpc: "0.0333",
          unrealized_intraday_pl: "20.00",
          unrealized_intraday_plpc: "0.0129",
          current_price: "155.00",
          lastday_price: "152.00",
          change_today: "0.0197",
        },
      ]);

      const positions = await provider.getPositions();

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/positions");
      expect(positions).toHaveLength(1);
      const position = positions[0]!;
      expect(position.symbol).toBe("AAPL");
      expect(position.avg_entry_price).toBe(150);
      expect(position.qty).toBe(10);
      expect(position.side).toBe("long");
      expect(position.market_value).toBe(1550);
      expect(position.unrealized_pl).toBe(50);
    });

    it("returns empty array when no positions", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce([]);

      const positions = await provider.getPositions();

      expect(positions).toEqual([]);
    });
  });

  describe("getPosition", () => {
    it("fetches single position by symbol", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        asset_id: "asset-1",
        symbol: "AAPL",
        exchange: "NASDAQ",
        asset_class: "us_equity",
        avg_entry_price: "150.00",
        qty: "10",
        side: "long",
        market_value: "1550.00",
        cost_basis: "1500.00",
        unrealized_pl: "50.00",
        unrealized_plpc: "0.0333",
        unrealized_intraday_pl: "20.00",
        unrealized_intraday_plpc: "0.0129",
        current_price: "155.00",
        lastday_price: "152.00",
        change_today: "0.0197",
      });

      const position = await provider.getPosition("AAPL");

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/positions/AAPL");
      expect(position?.symbol).toBe("AAPL");
    });

    it("returns null when position not found", async () => {
      mockClient.tradingRequest.mockRejectedValueOnce({ code: "NOT_FOUND" });

      const position = await provider.getPosition("NONEXISTENT");

      expect(position).toBeNull();
    });

    it("rethrows non-404 errors", async () => {
      mockClient.tradingRequest.mockRejectedValueOnce({ code: "PROVIDER_ERROR" });

      await expect(provider.getPosition("AAPL")).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
      });
    });

    it("encodes symbol in URL", async () => {
      mockClient.tradingRequest.mockRejectedValueOnce({ code: "NOT_FOUND" });

      await provider.getPosition("BTC/USD");

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/positions/BTC%2FUSD");
    });
  });

  describe("closePosition", () => {
    it("closes entire position", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({ id: "order-123" });

      await provider.closePosition("AAPL");

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("DELETE", "/v2/positions/AAPL");
    });

    it("closes partial position by qty", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({ id: "order-123" });

      await provider.closePosition("AAPL", 5);

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("DELETE", "/v2/positions/AAPL?qty=5");
    });

    it("closes partial position by percentage", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({ id: "order-123" });

      await provider.closePosition("AAPL", undefined, 50);

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("DELETE", "/v2/positions/AAPL?percentage=50");
    });
  });

  describe("createOrder", () => {
    it("creates market order", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "order-123",
        status: "accepted",
      });

      const order = await provider.createOrder({
        symbol: "AAPL",
        qty: 10,
        side: "buy",
        type: "market",
        time_in_force: "day",
      });

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("POST", "/v2/orders", {
        symbol: "AAPL",
        qty: "10",
        side: "buy",
        type: "market",
        time_in_force: "day",
      });
      expect(order.id).toBe("order-123");
    });

    it("creates limit order with price", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "order-123",
        status: "accepted",
      });

      await provider.createOrder({
        symbol: "AAPL",
        qty: 10,
        side: "buy",
        type: "limit",
        time_in_force: "gtc",
        limit_price: 150.5,
      });

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("POST", "/v2/orders", {
        symbol: "AAPL",
        qty: "10",
        side: "buy",
        type: "limit",
        time_in_force: "gtc",
        limit_price: "150.5",
      });
    });

    it("creates stop order with stop price", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "order-123",
        status: "accepted",
      });

      await provider.createOrder({
        symbol: "AAPL",
        qty: 10,
        side: "sell",
        type: "stop",
        time_in_force: "gtc",
        stop_price: 140,
      });

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("POST", "/v2/orders", {
        symbol: "AAPL",
        qty: "10",
        side: "sell",
        type: "stop",
        time_in_force: "gtc",
        stop_price: "140",
      });
    });

    it("creates order with notional value", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "order-123",
        status: "accepted",
      });

      await provider.createOrder({
        symbol: "AAPL",
        notional: 1000,
        side: "buy",
        type: "market",
        time_in_force: "day",
      });

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("POST", "/v2/orders", {
        symbol: "AAPL",
        notional: "1000",
        side: "buy",
        type: "market",
        time_in_force: "day",
      });
    });

    it("creates trailing stop order", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "order-123",
        status: "accepted",
      });

      await provider.createOrder({
        symbol: "AAPL",
        qty: 10,
        side: "sell",
        type: "trailing_stop",
        time_in_force: "gtc",
        trail_percent: 5,
      });

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("POST", "/v2/orders", {
        symbol: "AAPL",
        qty: "10",
        side: "sell",
        type: "trailing_stop",
        time_in_force: "gtc",
        trail_percent: "5",
      });
    });

    it("includes extended_hours flag", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "order-123",
        status: "accepted",
      });

      await provider.createOrder({
        symbol: "AAPL",
        qty: 10,
        side: "buy",
        type: "limit",
        time_in_force: "day",
        limit_price: 150,
        extended_hours: true,
      });

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("POST", "/v2/orders", {
        symbol: "AAPL",
        qty: "10",
        side: "buy",
        type: "limit",
        time_in_force: "day",
        limit_price: "150",
        extended_hours: true,
      });
    });

    it("includes client_order_id", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "order-123",
        status: "accepted",
      });

      await provider.createOrder({
        symbol: "AAPL",
        qty: 10,
        side: "buy",
        type: "market",
        time_in_force: "day",
        client_order_id: "my-order-123",
      });

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("POST", "/v2/orders", {
        symbol: "AAPL",
        qty: "10",
        side: "buy",
        type: "market",
        time_in_force: "day",
        client_order_id: "my-order-123",
      });
    });
  });

  describe("getOrder", () => {
    it("fetches order by ID", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "order-123",
        status: "filled",
      });

      const order = await provider.getOrder("order-123");

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/orders/order-123");
      expect(order.id).toBe("order-123");
    });
  });

  describe("listOrders", () => {
    it("lists all orders without params", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce([{ id: "order-1" }, { id: "order-2" }]);

      const orders = await provider.listOrders();

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/orders");
      expect(orders).toHaveLength(2);
    });

    it("lists orders with status filter", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce([{ id: "order-1" }]);

      await provider.listOrders({ status: "open" });

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/orders?status=open");
    });

    it("lists orders with multiple params", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce([]);

      await provider.listOrders({
        status: "closed",
        limit: 50,
        direction: "desc",
        symbols: ["AAPL", "GOOGL"],
      });

      const call = mockClient.tradingRequest.mock.calls[0] as [string, string];
      expect(call[0]).toBe("GET");
      expect(call[1]).toContain("status=closed");
      expect(call[1]).toContain("limit=50");
      expect(call[1]).toContain("direction=desc");
      expect(call[1]).toContain("symbols=AAPL%2CGOOGL");
    });
  });

  describe("cancelOrder", () => {
    it("cancels order by ID", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce(undefined);

      await provider.cancelOrder("order-123");

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("DELETE", "/v2/orders/order-123");
    });
  });

  describe("cancelAllOrders", () => {
    it("cancels all orders", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce(undefined);

      await provider.cancelAllOrders();

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("DELETE", "/v2/orders");
    });
  });

  describe("getClock", () => {
    it("fetches market clock", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        timestamp: "2024-01-15T10:30:00-05:00",
        is_open: true,
        next_open: "2024-01-16T09:30:00-05:00",
        next_close: "2024-01-15T16:00:00-05:00",
      });

      const clock = await provider.getClock();

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/clock");
      expect(clock.is_open).toBe(true);
      expect(clock.timestamp).toBe("2024-01-15T10:30:00-05:00");
    });
  });

  describe("getCalendar", () => {
    it("fetches market calendar", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce([
        {
          date: "2024-01-15",
          open: "09:30",
          close: "16:00",
          settlement_date: "2024-01-17",
        },
        {
          date: "2024-01-16",
          open: "09:30",
          close: "16:00",
          settlement_date: "2024-01-18",
        },
      ]);

      const calendar = await provider.getCalendar("2024-01-15", "2024-01-16");

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/calendar?start=2024-01-15&end=2024-01-16");
      expect(calendar).toHaveLength(2);
      expect(calendar[0]!.date).toBe("2024-01-15");
    });
  });

  describe("getAsset", () => {
    it("fetches asset by symbol", async () => {
      mockClient.tradingRequest.mockResolvedValueOnce({
        id: "asset-123",
        symbol: "AAPL",
        name: "Apple Inc.",
        tradable: true,
      });

      const asset = await provider.getAsset("AAPL");

      expect(mockClient.tradingRequest).toHaveBeenCalledWith("GET", "/v2/assets/AAPL");
      expect(asset?.symbol).toBe("AAPL");
    });

    it("returns null when asset not found", async () => {
      mockClient.tradingRequest.mockRejectedValueOnce({ code: "NOT_FOUND" });

      const asset = await provider.getAsset("NONEXISTENT");

      expect(asset).toBeNull();
    });

    it("rethrows non-404 errors", async () => {
      mockClient.tradingRequest.mockRejectedValueOnce({ code: "PROVIDER_ERROR" });

      await expect(provider.getAsset("AAPL")).rejects.toMatchObject({
        code: "PROVIDER_ERROR",
      });
    });
  });
});
