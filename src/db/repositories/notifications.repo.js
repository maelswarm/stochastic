const pool = require('../pool');

async function create(userId, alertEventId) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, alert_event_id) VALUES ($1, $2) RETURNING *`,
    [userId, alertEventId]
  );
  return rows[0];
}

async function listForUser(userId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT n.*, e.signal_key, e.triggered_at, e.bar_ts, e.payload, i.symbol, i.asset_class
     FROM notifications n
     JOIN alert_events e ON e.id = n.alert_event_id
     JOIN instruments i ON i.id = e.instrument_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function unreadCount(userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  );
  return Number(rows[0].count);
}

async function markAllRead(userId) {
  await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
}

async function markRead(userId, id) {
  await pool.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2', [id, userId]);
}

module.exports = { create, listForUser, unreadCount, markAllRead, markRead };
