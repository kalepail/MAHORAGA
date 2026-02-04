import { createError, ErrorCode } from "../../lib/errors";

export interface AlpacaClientConfig {
  apiKey: string;
  apiSecret: string;
  paper: boolean;
}

export class AlpacaClient {
  private tradingBaseUrl: string;
  private dataBaseUrl: string;
  private headers: Record<string, string>;

  constructor(config: AlpacaClientConfig) {
    this.tradingBaseUrl = config.paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
    this.dataBaseUrl = "https://data.alpaca.markets";
    this.headers = {
      "APCA-API-KEY-ID": config.apiKey,
      "APCA-API-SECRET-KEY": config.apiSecret,
      "Content-Type": "application/json",
    };
  }

  async tradingRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.tradingBaseUrl}${path}`;
    return this.request<T>(method, url, body);
  }

  async dataRequest<T>(method: string, path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    let url = `${this.dataBaseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return this.request<T>(method, url);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const options: RequestInit = {
      method,
      headers: this.headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;

      try {
        const errorJson = JSON.parse(errorBody) as { message?: string };
        errorMessage = errorJson.message ?? errorBody;
      } catch {
        errorMessage = errorBody;
      }

      if (response.status === 401) {
        throw createError(ErrorCode.UNAUTHORIZED, `Alpaca authentication failed: ${errorMessage}`);
      }
      if (response.status === 403) {
        throw createError(ErrorCode.FORBIDDEN, `Alpaca access denied: ${errorMessage}`);
      }
      if (response.status === 404) {
        throw createError(ErrorCode.NOT_FOUND, `Alpaca resource not found: ${errorMessage}`);
      }
      if (response.status === 422) {
        throw createError(ErrorCode.INVALID_INPUT, `Alpaca validation error: ${errorMessage}`);
      }
      if (response.status === 429) {
        throw createError(ErrorCode.RATE_LIMITED, `Alpaca rate limit exceeded: ${errorMessage}`);
      }

      throw createError(ErrorCode.PROVIDER_ERROR, `Alpaca API error (${response.status}): ${errorMessage}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}

export function createAlpacaClient(config: AlpacaClientConfig): AlpacaClient {
  return new AlpacaClient(config);
}
