const pool = require('../pool');

async function listForUser(userId) {
  const { rows } = await pool.query(
    `SELECT r.*, i.symbol, i.name AS instrument_name, i.asset_class
     FROM alert_rules r JOIN instruments i ON i.id = r.instrument_id
     WHERE r.user_id = $1 ORDER BY r.created_at DESC`,
    [userId]
  );
  return rows;
}

async function listActive() {
  const { rows } = await pool.query(
    `SELECT r.*, i.symbol, i.name AS instrument_name, i.asset_class, i.provider_symbols
     FROM alert_rules r JOIN instruments i ON i.id = r.instrument_id
     WHERE r.active`
  );
  return rows;
}

async function create({ userId, instrumentId, signalKey, timeframe, params, cooldownMinutes, emailEnabled }) {
  const { rows } = await pool.query(
    `INSERT INTO alert_rules (user_id, instrument_id, signal_key, timeframe, params, cooldown_minutes, email_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, instrumentId, signalKey, timeframe, JSON.stringify(params || {}), cooldownMinutes || 60, emailEnabled !== false]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM alert_rules WHERE id = $1', [id]);
  return rows[0] || null;
}

async function setActive(id, userId, active) {
  await pool.query('UPDATE alert_rules SET active = $3 WHERE id = $1 AND user_id = $2', [id, userId, active]);
}

async function remove(id, userId) {
  await pool.query('DELETE FROM alert_rules WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function markTriggered(id) {
  await pool.query('UPDATE alert_rules SET last_triggered_at = now() WHERE id = $1', [id]);
}

module.exports = { listForUser, listActive, create, findById, setActive, remove, markTriggered };
