// Provider registry: routes each asset class to its adapter and hides BYOK
// credential lookup + budgeting + key-status bookkeeping from callers.
// cache.service.js and the poll scheduler are the only consumers.
const apiKeysRepo = require('../../db/repositories/apiKeys.repo');
const budget = require('./budget.service');
const alpaca = require('./alpaca.adapter');

const ADAPTERS = { alpaca };

// Scope is blue-chip US stocks only (Alpaca, BYOK). Crypto (Binance),
// commodities (Twelve Data), and futures (Yahoo) were all evaluated during
// implementation and pulled back out -- crypto because api.binance.com
// geo-blocks US server IPs, commodities/futures because the user wants a
// stocks-only app. Those adapters are still on disk
// (binance.adapter.js, twelvedata.adapter.js, yahoo.adapter.js) if this
// scope ever expands again -- re-adding one is picking it back up here.
const PROVIDER_BY_ASSET_CLASS = {
  stock: 'alpaca',
};

function providerFor(instrument) {
  return PROVIDER_BY_ASSET_CLASS[instrument.asset_class];
}

function requiresKey(provider) {
  return provider === 'alpaca';
}

class NoKeyError extends Error {
  constructor(provider) {
    super(`No ${provider} API key connected.`);
    this.code = 'NO_KEY';
    this.provider = provider;
  }
}

async function resolveCredentials(userId, provider) {
  if (!requiresKey(provider)) return null;
  const row = await apiKeysRepo.getCredentials(userId, provider);
  if (!row) throw new NoKeyError(provider);
  return row.credentials;
}

// Wraps an adapter call with budgeting (for keyed providers) and maps
// provider errors onto key status so the settings UI reflects reality.
// `lane` picks which budget lane paces this call -- see budget.service.
async function callAdapter(userId, instrument, fn, lane = 'live') {
  const provider = providerFor(instrument);
  if (!provider) throw new Error(`No data provider available for asset class "${instrument.asset_class}".`);
  const adapter = ADAPTERS[provider];
  const needsKey = requiresKey(provider);

  if (needsKey && budget.isRateLimited(userId, provider)) {
    const err = new Error(`${provider} is rate-limited for this user; try again shortly.`);
    err.code = 'RATE_LIMITED';
    throw err;
  }

  const credentials = await resolveCredentials(userId, provider);
  if (needsKey) await budget.acquire(userId, provider, lane);

  try {
    const result = await fn(adapter, credentials);
    if (needsKey) await apiKeysRepo.markStatus(userId, provider, 'ok');
    return result;
  } catch (err) {
    if (needsKey) {
      if (err.rateLimited) {
        budget.markRateLimited(userId, provider);
        await apiKeysRepo.markStatus(userId, provider, 'rate_limited', { rateLimitedUntil: new Date(Date.now() + 60000) });
      } else if (err.status === 401 || err.status === 403 || err.invalid) {
        await apiKeysRepo.markStatus(userId, provider, 'invalid');
      }
    }
    throw err;
  }
}

async function getCandles(userId, instrument, timeframe, opts = {}) {
  const { lane, ...fetchOpts } = opts;
  return callAdapter(userId, instrument, (adapter, credentials) =>
    adapter.getCandles({ credentials, instrument, timeframe, ...fetchOpts }), lane);
}

async function getQuote(userId, instrument) {
  return callAdapter(userId, instrument, (adapter, credentials) => adapter.getQuote({ credentials, instrument }));
}

async function getOrderbook() {
  // No currently-active provider supplies orderbook depth (that was
  // crypto/Binance-only -- see the PROVIDER_BY_ASSET_CLASS note above).
  return null;
}

async function testKey(provider, credentials) {
  const adapter = ADAPTERS[provider];
  if (!adapter || !adapter.testKey) throw new Error(`Unknown provider "${provider}".`);
  return adapter.testKey(credentials);
}

module.exports = { providerFor, requiresKey, getCandles, getQuote, getOrderbook, testKey, NoKeyError, PROVIDER_BY_ASSET_CLASS };
