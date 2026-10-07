// Alpaca Market Data v2 adapter -- primary provider (BYOK). Free-tier keys
// get IEX-feed stock bars/quotes plus crypto bars/quotes under the same
// key. Trading-account keys and data-only keys both work against these
// data.alpaca.markets endpoints.
const DATA_BASE = 'https://data.alpaca.markets';

const TIMEFRAME_MAP = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '1h': '1Hour',
  '4h': '4Hour',
  '1D': '1Day',
  '1W': '1Week',
};

// Calendar days needed to cover one bar of each timeframe, generously
// (trading hours/days only cover a fraction of the calendar -- better to
// over-ask and let `limit` cap the response than under-ask and get nothing).
const CALENDAR_DAYS_PER_BAR = {
  '1m': 1 / 390,
  '5m': 5 / 390,
  '15m': 15 / 390,
  '1h': 1 / 6.5,
  '4h': 4 / 6.5,
  '1D': 1,
  '1W': 7,
};

// Alpaca's /bars endpoint defaults `start` to the beginning of the current
// day when it's omitted -- so a request with only `limit` set silently
// returns just today's (possibly nonexistent) bar instead of real history.
// Always send an explicit start computed from limit + timeframe instead of
// relying on that default.
function defaultStart(timeframe, limit) {
  const days = Math.ceil((limit * (CALENDAR_DAYS_PER_BAR[timeframe] || 1)) / 0.65) + 5;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  return start;
}

class ProviderError extends Error {
  constructor(message, { status, rateLimited } = {}) {
    super(message);
    this.status = status;
    this.rateLimited = !!rateLimited;
  }
}

async function request(credentials, path, params) {
  const url = new URL(DATA_BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': credentials.keyId,
      'APCA-API-SECRET-KEY': credentials.secret,
    },
  });

  if (res.status === 429) throw new ProviderError('Alpaca rate limit exceeded', { status: 429, rateLimited: true });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderError(`Alpaca error ${res.status}: ${body.slice(0, 200)}`, { status: res.status });
  }
  return res.json();
}

function symbolFor(instrument) {
  return (instrument.provider_symbols && instrument.provider_symbols.alpaca) || instrument.symbol;
}

async function getCandles({ credentials, instrument, timeframe, start, end, limit }) {
  const isCrypto = instrument.asset_class === 'crypto';
  const symbol = symbolFor(instrument);
  const path = isCrypto ? '/v1beta3/crypto/us/bars' : `/v2/stocks/${encodeURIComponent(symbol)}/bars`;
  const effectiveLimit = limit || 1000;
  const params = {
    timeframe: TIMEFRAME_MAP[timeframe],
    start: (start || defaultStart(timeframe, effectiveLimit)).toISOString(),
    end: end ? end.toISOString() : undefined,
    limit: effectiveLimit,
  };
  if (isCrypto) {
    params.symbols = symbol;
  } else {
    params.adjustment = 'raw';
    params.feed = 'iex';
  }
  // Alpaca returns bars oldest-first and applies `limit` from the start of
  // the window -- without this, "limit 500" means the oldest 500 bars after
  // `start`, not the latest 500 before now. sort=desc flips that to
  // latest-N; we reverse back to ascending below since every caller
  // (cache upsert, chart, signal engine) expects chronological order.
  params.sort = 'desc';

  const data = await request(credentials, path, params);
  const bars = (isCrypto ? (data.bars && data.bars[symbol]) || [] : data.bars || []).slice().reverse();
  return bars.map((b) => ({
    ts: new Date(b.t),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

async function getQuote({ credentials, instrument }) {
  const isCrypto = instrument.asset_class === 'crypto';
  const symbol = symbolFor(instrument);
  const path = isCrypto ? '/v1beta3/crypto/us/latest/quotes' : `/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`;
  const params = isCrypto ? { symbols: symbol } : { feed: 'iex' };

  const data = await request(credentials, path, params);
  const q = isCrypto ? data.quotes && data.quotes[symbol] : data.quote;
  if (!q) return null;
  return {
    bidPrice: q.bp,
    bidSize: q.bs,
    askPrice: q.ap,
    askSize: q.as,
    ts: new Date(q.t),
  };
}

async function getTrade({ credentials, instrument }) {
  const isCrypto = instrument.asset_class === 'crypto';
  const symbol = symbolFor(instrument);
  const path = isCrypto ? '/v1beta3/crypto/us/latest/trades' : `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`;
  const params = isCrypto ? { symbols: symbol } : { feed: 'iex' };

  const data = await request(credentials, path, params);
  const t = isCrypto ? data.trades && data.trades[symbol] : data.trade;
  if (!t) return null;
  return { price: t.p, size: t.s, ts: new Date(t.t) };
}

async function testKey(credentials) {
  try {
    await request(credentials, '/v2/stocks/AAPL/trades/latest', { feed: 'iex' });
    return { ok: true };
  } catch (err) {
    if (err.status === 401 || err.status === 403) return { ok: false, reason: 'invalid' };
    if (err.rateLimited) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'error', detail: err.message };
  }
}

module.exports = { name: 'alpaca', getCandles, getQuote, getTrade, testKey, ProviderError, TIMEFRAME_MAP };
