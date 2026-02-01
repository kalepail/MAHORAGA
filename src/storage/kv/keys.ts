export const CacheKeys = {
  symbolOverview: (symbol: string) => `overview:${symbol}`,
  symbolQuote: (symbol: string) => `quote:${symbol}`,
  symbolBars: (symbol: string, timeframe: string) => `bars:${symbol}:${timeframe}`,
  movers: (direction: "up" | "down") => `movers:${direction}`,
  macroSnapshot: () => "macro:snapshot",
  marketClock: () => "market:clock",
  marketCalendar: (month: string) => `market:calendar:${month}`,
  technicals: (symbol: string) => `technicals:${symbol}`,
  signals: (symbol: string) => `signals:${symbol}`,
  newsIndex: (symbol: string) => `news:index:${symbol}`,
  discoveryList: (listId: string) => `discovery:${listId}`,
} as const;

export const CacheTTL = {
  QUOTE: 30,
  OVERVIEW: 300,
  BARS_INTRADAY: 60,
  BARS_DAILY: 3600,
  MOVERS: 120,
  MACRO: 600,
  CLOCK: 60,
  CALENDAR: 86400,
  TECHNICALS: 120,
  SIGNALS: 120,
  NEWS_INDEX: 300,
  DISCOVERY: 300,
} as const;
