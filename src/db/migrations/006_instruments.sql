CREATE TABLE instruments (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('stock', 'crypto', 'commodity', 'future')),
  exchange TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  -- Per-provider symbol spellings, e.g. {"alpaca": "AAPL", "binance": "BTCUSDT", "yahoo": "GC=F"}
  provider_symbols JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, asset_class)
);
CREATE INDEX instruments_symbol_trgm_idx ON instruments USING gin (symbol gin_trgm_ops);
CREATE INDEX instruments_name_trgm_idx ON instruments USING gin (name gin_trgm_ops);
CREATE INDEX instruments_asset_class_idx ON instruments(asset_class) WHERE active;
