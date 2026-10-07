-- Unified table for activation + password-reset tokens: identical lifecycle
-- (random secret -> stored as sha256 hash -> expiry -> single-use), only
-- purpose/TTL/post-consumption effect differ, handled in application code.
CREATE TABLE one_time_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('activation', 'password_reset')),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_time_tokens_token_hash_idx ON one_time_tokens(token_hash);
CREATE INDEX one_time_tokens_user_purpose_idx ON one_time_tokens(user_id, purpose);
