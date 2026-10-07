const pool = require('../pool');

async function getRange(instrumentId, timeframe, fromTs, toTs) {
  const { rows } = await pool.query(
    `SELECT ts, open, high, low, close, volume FROM candles
     WHERE instrument_id = $1 AND timeframe = $2 AND ts >= $3 AND ts <= $4
     ORDER BY ts ASC`,
    [instrumentId, timeframe, fromTs, toTs]
  );
  return rows;
}

async function getLatest(instrumentId, timeframe, limit = 500) {
  const { rows } = await pool.query(
    `SELECT ts, open, high, low, close, volume FROM
       (SELECT ts, open, high, low, close, volume FROM candles
        WHERE instrument_id = $1 AND timeframe = $2
        ORDER BY ts DESC LIMIT $3) sub
     ORDER BY ts ASC`,
    [instrumentId, timeframe, limit]
  );
  return rows;
}

async function upsertMany(instrumentId, timeframe, bars) {
  if (bars.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const bar of bars) {
      await client.query(
        `INSERT INTO candles (instrument_id, timeframe, ts, open, high, low, close, volume)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (instrument_id, timeframe, ts)
         DO UPDATE SET open = $4, high = $5, low = $6, close = $7, volume = $8`,
        [instrumentId, timeframe, bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Bar count capped at `cap` -- callers only ever need to know whether the
// series is shallower than some target depth, not the true total.
async function countBars(instrumentId, timeframe, cap) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM
       (SELECT 1 FROM candles WHERE instrument_id = $1 AND timeframe = $2 LIMIT $3) sub`,
    [instrumentId, timeframe, cap]
  );
  return rows[0].n;
}

async function getSyncState(instrumentId, timeframe) {
  const { rows } = await pool.query(
    'SELECT * FROM candle_sync_state WHERE instrument_id = $1 AND timeframe = $2',
    [instrumentId, timeframe]
  );
  return rows[0] || null;
}

async function setSyncState(instrumentId, timeframe, { lastBarTs }) {
  await pool.query(
    `INSERT INTO candle_sync_state (instrument_id, timeframe, last_synced_at, last_bar_ts)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (instrument_id, timeframe)
     DO UPDATE SET last_synced_at = now(), last_bar_ts = $3`,
    [instrumentId, timeframe, lastBarTs]
  );
}

module.exports = { getRange, getLatest, countBars, upsertMany, getSyncState, setSyncState };
