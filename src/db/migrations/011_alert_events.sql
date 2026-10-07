CREATE TABLE alert_events (
  id BIGSERIAL PRIMARY KEY,
  rule_id BIGINT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bar_ts TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  emailed_at TIMESTAMPTZ,
  -- One detection per (rule, bar): prevents duplicate events if the
  -- scheduler re-evaluates the same closed bar more than once.
  UNIQUE (rule_id, bar_ts)
);
CREATE INDEX alert_events_instrument_idx ON alert_events(instrument_id, triggered_at DESC);
