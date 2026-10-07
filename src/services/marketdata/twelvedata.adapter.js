// Twelve Data adapter -- secondary BYOK provider, used only for commodity
// spot symbols (XAU/USD, WTI, ...) that Alpaca doesn't carry. Optional: if
// a user has no Twelve Data key, commodity instruments simply show as
// unavailable rather than blocking anything else.
const BASE = 'https://api.twelvedata.com';

const INTERVAL_MAP = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1D': '1day',
  '1W': '1week',
};

function symbolFor(instrument) {
  return (instrument.provider_symbols && instrument.provider_symbols.twelvedata) || instrument.symbol;
}

async function request(credentials, path, params) {
  const url = new URL(BASE + path);
  Object.entries({ ...params, apikey: credentials.apiKey }).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (data && data.status === 'error') {
    const err = new Error(data.message || 'Twelve Data error');
    err.rateLimited = /limit/i.test(data.message || '');
    err.invalid = data.code === 401 || /api key/i.test(data.message || '');
    throw err;
  }
  return data;
}

async function getCandles({ credentials, instrument, timeframe, limit }) {
  const symbol = symbolFor(instrument);
  const data = await request(credentials, '/time_series', {
    symbol,
    interval: INTERVAL_MAP[timeframe],
    outputsize: limit || 500,
  });
  const values = data.values || [];
  return values
    .map((v) => ({
      ts: new Date(v.datetime.length <= 10 ? `${v.datetime}T00:00:00Z` : v.datetime.replace(' ', 'T') + 'Z'),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume || 0),
    }))
    .sort((a, b) => a.ts - b.ts);
}

async function getQuote({ credentials, instrument }) {
  const symbol = symbolFor(instrument);
  const data = await request(credentials, '/quote', { symbol });
  if (!data || !data.close) return null;
  return { price: Number(data.close), ts: new Date() };
}

async function testKey(credentials) {
  try {
    await request(credentials, '/quote', { symbol: 'XAU/USD' });
    return { ok: true };
  } catch (err) {
    if (err.invalid) return { ok: false, reason: 'invalid' };
    if (err.rateLimited) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'error', detail: err.message };
  }
}

module.exports = { name: 'twelvedata', getCandles, getQuote, testKey };
