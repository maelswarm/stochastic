// Discovers the tradable stock universe from Alpaca (GET /v2/assets on the
// trading API) and upserts it into the instruments table. Shared by
// scripts/seed-instruments.js (manual one-off run) and
// instrumentSyncScheduler.js (automatic daily run).
//
// No operator/fallback Alpaca key exists anywhere in this app -- BYOK means
// the only credentials that exist are ones a real signed-up user typed in.
// Listing assets still needs some authenticated Alpaca call, so this
// borrows one already-connected user's own key (apiKeysRepo.getCredentials),
// the same "any valid key can serve a shared, non-user-specific read"
// pattern apiKeysRepo.listActiveKeysForProvider already exists for. It does
// not grant that user's key any wider use -- actual candle/quote data still
// requires each user's own key, unchanged (see marketdata/index.js).
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const apiKeysRepo = require('../../db/repositories/apiKeys.repo');
const pool = require('../../db/pool');

const ALLOWED_EXCHANGES = new Set(['NYSE', 'NASDAQ']);
const TRADING_BASES = ['https://paper-api.alpaca.markets', 'https://api.alpaca.markets'];

// Used as the benchmark for beta/correlation metrics and the
// "correlation breakdown vs SPY" signal (see services/signals/engine.js and
// routes/api/metrics.routes.js). It's an ARCA-listed ETF, so it fails the
// NYSE/NASDAQ filter above -- fetch and protect it explicitly so it never
// gets swept up by the deactivation pass below.
const REQUIRED_SYMBOL = 'SPY';

async function findWorkingCredentials() {
  const userIds = await apiKeysRepo.listActiveKeysForProvider('alpaca');
  if (userIds.length === 0) {
    throw new Error(
      'No user has connected a working Alpaca key yet -- instrument sync borrows an existing ' +
      "user's own key to list assets (no operator key exists in this app). Connect an Alpaca " +
      'key via Settings, then instrument sync will pick it up on its next run.'
    );
  }

  for (const userId of userIds) {
    const row = await apiKeysRepo.getCredentials(userId, 'alpaca');
    if (!row) continue;
    for (const base of TRADING_BASES) {
      const res = await fetch(new URL('/v2/assets?status=active&asset_class=us_equity', base), {
        headers: {
          'APCA-API-KEY-ID': row.credentials.keyId,
          'APCA-API-SECRET-KEY': row.credentials.secret,
        },
      });
      if (res.ok) return { credentials: row.credentials, base, response: res };
    }
  }

  throw new Error('Found connected Alpaca key(s), but none could authenticate against either the paper or live trading API.');
}

async function fetchAsset(credentials, base, symbol) {
  const res = await fetch(new URL(`/v2/assets/${symbol}`, base), {
    headers: {
      'APCA-API-KEY-ID': credentials.keyId,
      'APCA-API-SECRET-KEY': credentials.secret,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// Returns { upserted, deactivated }.
async function syncInstruments({ log = console.log } = {}) {
  log('[instrumentSync] Looking for a connected Alpaca key to list assets with...');
  const { credentials, base, response } = await findWorkingCredentials();
  log(`[instrumentSync] Fetching tradable assets from ${base}...`);
  const assets = await response.json();

  const stocks = assets.filter(
    (a) => a.tradable && ALLOWED_EXCHANGES.has(a.exchange) && a.symbol && a.name
  );
  log(`[instrumentSync] ${assets.length} active us_equity assets from Alpaca -> ${stocks.length} tradable on NYSE/NASDAQ.`);

  if (!stocks.some((a) => a.symbol === REQUIRED_SYMBOL)) {
    const spy = await fetchAsset(credentials, base, REQUIRED_SYMBOL);
    if (spy && spy.tradable) {
      stocks.push(spy);
      log(`[instrumentSync] Added ${REQUIRED_SYMBOL} explicitly (exchange: ${spy.exchange}, not in the NYSE/NASDAQ filter).`);
    } else {
      log(`[instrumentSync] WARNING: could not fetch ${REQUIRED_SYMBOL} from Alpaca -- beta/correlation metrics need it and it will not be seeded.`);
    }
  }

  const seenSymbols = [];
  for (const a of stocks) {
    await instrumentsRepo.upsert({
      symbol: a.symbol,
      name: a.name,
      assetClass: 'stock',
      exchange: a.exchange,
      currency: 'USD',
      providerSymbols: { alpaca: a.symbol },
    });
    seenSymbols.push(a.symbol);
  }
  log(`[instrumentSync] Upserted ${seenSymbols.length} stocks.`);

  const { rowCount } = await pool.query(
    `UPDATE instruments SET active = false
     WHERE asset_class = 'stock' AND active AND symbol != ALL($1::text[]) AND symbol != $2`,
    [seenSymbols, REQUIRED_SYMBOL]
  );
  if (rowCount > 0) log(`[instrumentSync] Deactivated ${rowCount} stock(s) no longer tradable on Alpaca.`);

  return { upserted: seenSymbols.length, deactivated: rowCount };
}

module.exports = { syncInstruments };
