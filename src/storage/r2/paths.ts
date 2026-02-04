export const R2Paths = {
  newsArticle: (symbol: string, date: string, slug: string) => `content/${symbol}/news/${date}-${slug}.md`,

  report: (symbol: string, timestamp: string) => `content/${symbol}/reports/${timestamp}.md`,

  latestReport: (symbol: string) => `content/${symbol}/reports/latest.md`,

  rawEvent: (source: string, eventId: string) => `raw/${source}/${eventId}.json`,

  scrapedContent: (domain: string, path: string, timestamp: string) =>
    `scraped/${domain}/${encodeURIComponent(path)}/${timestamp}.html`,

  tradeSnapshot: (tradeId: string) => `trades/${tradeId}/snapshot.json`,
} as const;

export function parseNewsPath(key: string): {
  symbol: string;
  date: string;
  slug: string;
} | null {
  const match = key.match(/^content\/([^/]+)\/news\/(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  if (!match) return null;
  const [, symbol, date, slug] = match;
  if (!symbol || !date || !slug) return null;
  return { symbol, date, slug };
}

export function parseReportPath(key: string): {
  symbol: string;
  timestamp: string;
} | null {
  const match = key.match(/^content\/([^/]+)\/reports\/(.+)\.md$/);
  if (!match) return null;
  const [, symbol, timestamp] = match;
  if (!symbol || !timestamp) return null;
  return { symbol, timestamp };
}
