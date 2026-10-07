CREATE TABLE alert_rules (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '5m', '15m', '1h', '4h', '1D', '1W')),
  params JSONB NOT NULL DEFAULT '{}',
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX alert_rules_active_idx ON alert_rules(instrument_id, timeframe) WHERE active;
CREATE INDEX alert_rules_user_idx ON alert_rules(user_id);
