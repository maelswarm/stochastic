const pool = require('../pool');

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createUser({ email, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2)
     RETURNING *`,
    [email, passwordHash]
  );
  return rows[0];
}

async function activateUser(userId) {
  await pool.query(
    `UPDATE users
     SET status = 'active', email_verified_at = now(), updated_at = now()
     WHERE id = $1`,
    [userId]
  );
}

async function updatePassword(userId, passwordHash) {
  await pool.query(
    `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
    [userId, passwordHash]
  );
}

module.exports = { findByEmail, findById, createUser, activateUser, updatePassword };
