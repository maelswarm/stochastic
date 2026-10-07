const pool = require('../pool');

async function listForUser(userId) {
  const { rows } = await pool.query(
    `SELECT w.id, w.position, i.* FROM watchlist_items w
     JOIN instruments i ON i.id = w.instrument_id
     WHERE w.user_id = $1
     ORDER BY w.position ASC, w.id ASC`,
    [userId]
  );
  return rows;
}

async function add(userId, instrumentId) {
  const { rows } = await pool.query(
    `INSERT INTO watchlist_items (user_id, instrument_id, position)
     VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM watchlist_items WHERE user_id = $1), 0))
     ON CONFLICT (user_id, instrument_id) DO NOTHING
     RETURNING *`,
    [userId, instrumentId]
  );
  return rows[0] || null;
}

async function remove(userId, instrumentId) {
  await pool.query('DELETE FROM watchlist_items WHERE user_id = $1 AND instrument_id = $2', [userId, instrumentId]);
}

async function allWatchedInstrumentIds() {
  const { rows } = await pool.query('SELECT DISTINCT instrument_id FROM watchlist_items');
  return rows.map((r) => r.instrument_id);
}

// One row per (user, instrument) -- used by the scheduler to know which
// user's key can be spent refreshing a given watched instrument.
async function listAllWithUsers() {
  const { rows } = await pool.query(
    `SELECT w.user_id, i.* FROM watchlist_items w JOIN instruments i ON i.id = w.instrument_id`
  );
  return rows;
}

module.exports = { listForUser, add, remove, allWatchedInstrumentIds, listAllWithUsers };
