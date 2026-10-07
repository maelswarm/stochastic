const pool = require('../pool');

async function search(query, limit = 15) {
  const { rows } = await pool.query(
    `SELECT * FROM instruments
     WHERE active AND (symbol ILIKE $1 || '%' OR name ILIKE '%' || $1 || '%')
     ORDER BY (symbol ILIKE $1 || '%') DESC, symbol ASC
     LIMIT $2`,
    [query, limit]
  );
  return rows;
}

async function findBySymbol(symbol, assetClass) {
  const { rows } = await pool.query(
    `SELECT * FROM instruments WHERE symbol = $1 AND asset_class = $2 AND active`,
    [symbol, assetClass]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM instruments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listByAssetClass(assetClass) {
  const { rows } = await pool.query(
    'SELECT * FROM instruments WHERE asset_class = $1 AND active ORDER BY symbol',
    [assetClass]
  );
  return rows;
}

async function listAll() {
  const { rows } = await pool.query('SELECT * FROM instruments WHERE active ORDER BY asset_class, symbol');
  return rows;
}

async function upsert({ symbol, name, assetClass, exchange, currency, providerSymbols }) {
  const { rows } = await pool.query(
    `INSERT INTO instruments (symbol, name, asset_class, exchange, currency, provider_symbols)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (symbol, asset_class)
     DO UPDATE SET name = $2, exchange = $4, currency = $5, provider_symbols = $6, active = true
     RETURNING *`,
    [symbol, name, assetClass, exchange || null, currency || 'USD', JSON.stringify(providerSymbols || {})]
  );
  return rows[0];
}

module.exports = { search, findBySymbol, findById, listByAssetClass, listAll, upsert };
