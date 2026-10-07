const pool = require('../pool');

// Invalidates any previously issued, still-unused tokens of this purpose so
// only the most recently sent link is usable (avoids stale earlier emails
// silently remaining valid alongside a freshly issued one).
async function issueToken({ userId, purpose, tokenHash, expiresAt }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE one_time_tokens
       SET used_at = now()
       WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
      [userId, purpose]
    );
    const { rows } = await client.query(
      `INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, purpose, tokenHash, expiresAt]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findValid(tokenHash, purpose) {
  const { rows } = await pool.query(
    `SELECT * FROM one_time_tokens
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash, purpose]
  );
  return rows[0] || null;
}

async function markUsed(tokenId) {
  await pool.query('UPDATE one_time_tokens SET used_at = now() WHERE id = $1', [tokenId]);
}

module.exports = { issueToken, findValid, markUsed };
