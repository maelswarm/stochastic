-- Bring-your-own-key storage. The key material is AES-256-GCM encrypted in
-- application code (services/marketdata/keys.service.js) before it ever
-- reaches this table; only ciphertext + a display-safe last4 land here.
CREATE TABLE user_api_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('alpaca', 'twelvedata')),
  encrypted_key TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'invalid', 'rate_limited')),
  rate_limited_until TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
