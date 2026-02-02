import { mockFetch } from "./api";

/**
 * Patches `window.fetch` to intercept API calls and return mock data.
 * Non-API requests (assets, HMR, etc.) pass through to the real fetch.
 */
export function enableMockMode() {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const mock = mockFetch(input, init);
    if (mock) return mock;
    return realFetch(input, init);
  };

  console.log("[MOCK MODE] Enabled — API calls return static mock data");
}
