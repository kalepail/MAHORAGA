/**
 * Date utilities for D1 storage.
 *
 * All dates stored in D1 use ISO 8601 format: "YYYY-MM-DDTHH:MM:SS.sssZ"
 * This is the native output of Date.toISOString() and Alpaca API responses,
 * is lexicographically sortable, and parsed by browsers as UTC.
 */

/** Convert any date-like input to ISO 8601 string, or null if invalid. */
export function toDbDatetime(input: string | number | Date | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Current time as ISO 8601 string. Replaces datetime('now') in SQL. */
export function dbNow(): string {
  return new Date().toISOString();
}

/** Time N seconds ago as ISO 8601 string. Replaces datetime('now', '-N seconds/hours/days'). */
export function dbTimeAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}
