const pool = require('../pool');
const keysService = require('../../services/marketdata/keys.service');

// credentials is a plain object, e.g. { keyId, secret } for alpaca --
// serialized to JSON, then AES-256-GCM encrypted as a single blob before
// it ever reaches a row.
async function upsertKey({ userId, provider, credentials }) {
  const encrypted = keysService.encrypt(JSON.stringify(credentials));
  const displaySecret = credentials.secret || credentials.apiKey || '';
  const { rows } = await pool.query(
    `INSERT INTO user_api_keys (user_id, provider, encrypted_key, key_last4, status, updated_at)
     VALUES ($1, $2, $3, $4, 'ok', now())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET encrypted_key = $3, key_last4 = $4, status = 'ok', rate_limited_until = NULL, updated_at = now()
     RETURNING id, user_id, provider, key_last4, status, last_verified_at, created_at, updated_at`,
    [userId, provider, encrypted, keysService.last4(displaySecret)]
  );
  return rows[0];
}

async function listForUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, provider, key_last4, status, rate_limited_until, last_verified_at, created_at, updated_at
     FROM user_api_keys WHERE user_id = $1 ORDER BY provider`,
    [userId]
  );
  return rows;
}

async function getCredentials(userId, provider) {
  const { rows } = await pool.query(
    `SELECT * FROM user_api_keys WHERE user_id = $1 AND provider = $2`,
    [userId, provider]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...row, credentials: JSON.parse(keysService.decrypt(row.encrypted_key)) };
}

async function deleteKey(userId, provider) {
  await pool.query('DELETE FROM user_api_keys WHERE user_id = $1 AND provider = $2', [userId, provider]);
}

async function markStatus(userId, provider, status, extra = {}) {
  await pool.query(
    `UPDATE user_api_keys
     SET status = $3, last_verified_at = CASE WHEN $3 = 'ok' THEN now() ELSE last_verified_at END,
         rate_limited_until = $4, updated_at = now()
     WHERE user_id = $1 AND provider = $2`,
    [userId, provider, status, extra.rateLimitedUntil || null]
  );
}

// Any user's valid Alpaca key can service a shared candle-cache refresh
// (the fetched OHLCV isn't user-specific), so the ingest scheduler picks
// whichever active key is least likely to be rate-limited right now.
async function listActiveKeysForProvider(provider) {
  const { rows } = await pool.query(
    `SELECT user_id FROM user_api_keys
     WHERE provider = $1 AND status = 'ok'
     ORDER BY last_verified_at DESC NULLS LAST`,
    [provider]
  );
  return rows.map((r) => r.user_id);
}

module.exports = { upsertKey, listForUser, getCredentials, deleteKey, markStatus, listActiveKeysForProvider };
