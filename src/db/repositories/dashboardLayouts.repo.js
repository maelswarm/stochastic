const pool = require('../pool');

async function get(userId) {
  const { rows } = await pool.query('SELECT layout FROM dashboard_layouts WHERE user_id = $1', [userId]);
  return rows[0] ? rows[0].layout : null;
}

async function save(userId, layout) {
  await pool.query(
    `INSERT INTO dashboard_layouts (user_id, layout, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET layout = $2, updated_at = now()`,
    [userId, JSON.stringify(layout)]
  );
}

module.exports = { get, save };
