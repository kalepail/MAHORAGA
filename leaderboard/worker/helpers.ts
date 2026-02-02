/**
 * Shared helper functions for the leaderboard worker.
 */

/** JSON response with proper Content-Type header. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Standard CORS headers. */
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

/**
 * Parse an integer from a query parameter with a fallback.
 * Returns the fallback if the value is missing, empty, or NaN.
 */
export function safeParseInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Return a sanitized error JSON response (never leak stack traces). */
export function errorJson(message: string, status: number): Response {
  return json({ error: message }, status);
}
