const pool = require('../pool');

// ON CONFLICT DO NOTHING relies on the (rule_id, bar_ts) unique constraint
// to make re-evaluating the same closed bar a no-op instead of a duplicate
// event/email.
async function create({ ruleId, instrumentId, signalKey, barTs, payload }) {
  const { rows } = await pool.query(
    `INSERT INTO alert_events (rule_id, instrument_id, signal_key, bar_ts, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (rule_id, bar_ts) DO NOTHING
     RETURNING *`,
    [ruleId, instrumentId, signalKey, barTs, JSON.stringify(payload || {})]
  );
  return rows[0] || null;
}

async function markEmailed(id) {
  await pool.query('UPDATE alert_events SET emailed_at = now() WHERE id = $1', [id]);
}

async function listRecentForInstrument(instrumentId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT * FROM alert_events WHERE instrument_id = $1 ORDER BY triggered_at DESC LIMIT $2`,
    [instrumentId, limit]
  );
  return rows;
}

async function listRecentForUser(userId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT e.*, i.symbol, i.asset_class FROM alert_events e
     JOIN alert_rules r ON r.id = e.rule_id
     JOIN instruments i ON i.id = e.instrument_id
     WHERE r.user_id = $1
     ORDER BY e.triggered_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function countEmailedForUserSince(userId, since) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM alert_events e
     JOIN alert_rules r ON r.id = e.rule_id
     WHERE r.user_id = $1 AND e.emailed_at IS NOT NULL AND e.emailed_at >= $2`,
    [userId, since]
  );
  return Number(rows[0].count);
}

module.exports = { create, markEmailed, listRecentForInstrument, listRecentForUser, countEmailedForUserSince };
