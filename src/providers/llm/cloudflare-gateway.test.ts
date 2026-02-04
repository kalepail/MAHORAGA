import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../../lib/errors";
import { CloudflareGatewayProvider, createCloudflareGatewayProvider } from "./cloudflare-gateway";

describe("Cloudflare Gateway Provider", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  const validConfig = {
    accountId: "test-account-id",
    gatewayId: "test-gateway-id",
    token: "test-token",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("createCloudflareGatewayProvider", () => {
    it("creates provider with required config", () => {
      const provider = createCloudflareGatewayProvider(validConfig);
      expect(provider).toBeInstanceOf(CloudflareGatewayProvider);
    });

    it("creates provider with custom model", () => {
      const provider = createCloudflareGatewayProvider({
        ...validConfig,
        model: "anthropic/claude-sonnet-4",
      });
      expect(provider).toBeInstanceOf(CloudflareGatewayProvider);
    });

    it("throws INVALID_INPUT when accountId is missing", () => {
      expect(() =>
        createCloudflareGatewayProvider({
          ...validConfig,
          accountId: "",
        })
      ).toThrow();
    });

    it("throws INVALID_INPUT when gatewayId is missing", () => {
      expect(() =>
        createCloudflareGatewayProvider({
          ...validConfig,
          gatewayId: "",
        })
      ).toThrow();
    });

    it("throws INVALID_INPUT when token is missing", () => {
      expect(() =>
        createCloudflareGatewayProvider({
          ...validConfig,
          token: "",
        })
      ).toThrow();
    });
  });

  describe("complete", () => {
    it("sends correct request to Cloudflare AI Gateway", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hello!" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const [url, options] = call;
      expect(url).toBe("https://gateway.ai.cloudflare.com/v1/test-account-id/test-gateway-id/compat/chat/completions");
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({
        "Content-Type": "application/json",
        "cf-aig-authorization": "Bearer test-token",
      });

      const body = JSON.parse(options.body as string);
      expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
    });

    it("returns completion result with content and usage", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Test response" } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      const result = await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.content).toBe("Test response");
      expect(result.usage).toEqual({
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30,
      });
    });

    it("uses default model (openai/gpt-4o-mini) when not specified", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("openai/gpt-4o-mini");
    });

    it("uses custom model when provided in params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        model: "anthropic/claude-sonnet-4",
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("anthropic/claude-sonnet-4");
    });

    it("uses config model when no param model specified", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider({
        ...validConfig,
        model: "google/gemini-2.5-flash",
      });
      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("google-ai-studio/gemini-2.5-flash");
    });

    it("includes response_format when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"key": "value"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
        response_format: { type: "json_object" },
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("uses default temperature and max_tokens", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(1024);
    });

    it("throws PROVIDER_ERROR on API failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const provider = createCloudflareGatewayProvider(validConfig);

      await expect(provider.complete({ messages: [{ role: "user", content: "Test" }] })).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ERROR,
      });
    });

    it("throws PROVIDER_ERROR on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      const provider = createCloudflareGatewayProvider(validConfig);

      await expect(provider.complete({ messages: [{ role: "user", content: "Test" }] })).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ERROR,
        message: expect.stringContaining("network error"),
      });
    });

    it("handles empty content in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: {} }],
          usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      const result = await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.content).toBe("");
    });

    it("handles missing usage in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      const result = await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });
  });

  describe("model normalization", () => {
    it("normalizes unqualified model names to openai/", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("openai/gpt-4o");
    });

    it("normalizes google/ to google-ai-studio/", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("google-ai-studio/gemini-2.5-pro");
    });

    it("normalizes xai/ to grok/", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        model: "xai/grok-4",
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("grok/grok-4");
    });

    it("normalizes workersai/ to workers-ai/", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        model: "workersai/llama-3-8b",
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("workers-ai/llama-3-8b");
    });

    it("normalizes anthropic model version dots to hyphens", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        model: "anthropic/claude-sonnet-4.5",
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("anthropic/claude-sonnet-4-5");
    });

    it("leaves deepseek/ unchanged", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createCloudflareGatewayProvider(validConfig);
      await provider.complete({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "user", content: "Test" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.model).toBe("deepseek/deepseek-chat");
    });
  });
});
