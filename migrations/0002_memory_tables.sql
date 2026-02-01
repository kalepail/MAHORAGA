CREATE TABLE trade_journal (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  trade_id TEXT REFERENCES trades(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL,
  entry_at TEXT,
  exit_price REAL,
  exit_at TEXT,
  qty REAL NOT NULL,
  pnl_usd REAL,
  pnl_pct REAL,
  hold_duration_mins INTEGER,
  signals_json TEXT,
  technicals_json TEXT,
  regime_tags TEXT,
  event_ids TEXT,
  outcome TEXT,
  notes TEXT,
  lessons_learned TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_trade_journal_symbol ON trade_journal(symbol);
CREATE INDEX idx_trade_journal_outcome ON trade_journal(outcome);
CREATE INDEX idx_trade_journal_regime ON trade_journal(regime_tags);
CREATE INDEX idx_trade_journal_created ON trade_journal(created_at);

CREATE TABLE memory_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  rule_type TEXT NOT NULL,
  description TEXT NOT NULL,
  conditions_json TEXT,
  confidence REAL,
  source TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_memory_rules_type ON memory_rules(rule_type);
CREATE INDEX idx_memory_rules_active ON memory_rules(active);

CREATE TABLE memory_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO memory_preferences (id) VALUES (1);
