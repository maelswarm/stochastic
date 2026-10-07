CREATE TABLE candles (
  instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '5m', '15m', '1h', '4h', '1D', '1W')),
  ts TIMESTAMPTZ NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (instrument_id, timeframe, ts)
);
-- Fetches read a whole (instrument, timeframe) range ordered by time; the PK
-- above already clusters on that access pattern so no extra index is needed.

CREATE TABLE candle_sync_state (
  instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '5m', '15m', '1h', '4h', '1D', '1W')),
  last_synced_at TIMESTAMPTZ,
  last_bar_ts TIMESTAMPTZ,
  PRIMARY KEY (instrument_id, timeframe)
);
