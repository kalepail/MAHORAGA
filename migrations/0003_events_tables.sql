CREATE TABLE raw_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  r2_key TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);

CREATE INDEX idx_raw_events_source ON raw_events(source);
CREATE INDEX idx_raw_events_ingested ON raw_events(ingested_at);

CREATE TABLE structured_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  raw_event_id TEXT REFERENCES raw_events(id),
  event_type TEXT NOT NULL,
  symbols TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL NOT NULL,
  validated INTEGER NOT NULL DEFAULT 0,
  validation_errors TEXT,
  trade_proposal_id TEXT,
  trade_id TEXT REFERENCES trades(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_structured_events_type ON structured_events(event_type);
CREATE INDEX idx_structured_events_symbols ON structured_events(symbols);
CREATE INDEX idx_structured_events_created ON structured_events(created_at);
CREATE INDEX idx_structured_events_validated ON structured_events(validated);

CREATE TABLE event_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  config_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_poll_at TEXT,
  poll_interval_mins INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_event_sources_active ON event_sources(active);

CREATE TABLE news_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  symbols TEXT NOT NULL,
  r2_key TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);

CREATE INDEX idx_news_items_symbols ON news_items(symbols);
CREATE INDEX idx_news_items_published ON news_items(published_at);
CREATE INDEX idx_news_items_created ON news_items(created_at);
