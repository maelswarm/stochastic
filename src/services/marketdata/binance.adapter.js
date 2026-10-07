// Binance public REST API adapter -- keyless, used for crypto candles and
// full L2 orderbook depth (the one asset class where free full-depth data
// actually exists). Never consumes a user's Alpaca/Twelve Data budget.
const REST_BASE = 'https://api.binance.com';

const INTERVAL_MAP = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1D': '1d',
  '1W': '1w',
};

function symbolFor(instrument) {
  return (instrument.provider_symbols && instrument.provider_symbols.binance) || instrument.symbol.replace('/', '');
}

async function request(path, params) {
  const url = new URL(REST_BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const res = await fetch(url);
  if (res.status === 429 || res.status === 418) {
    const err = new Error('Binance rate limit exceeded');
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Binance error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getCandles({ instrument, timeframe, start, end, limit }) {
  const symbol = symbolFor(instrument);
  const data = await request('/api/v3/klines', {
    symbol,
    interval: INTERVAL_MAP[timeframe],
    startTime: start ? start.getTime() : undefined,
    endTime: end ? end.getTime() : undefined,
    limit: limit || 1000,
  });
  return data.map((k) => ({
    ts: new Date(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

async function getOrderbook({ instrument, limit = 20 }) {
  const symbol = symbolFor(instrument);
  const data = await request('/api/v3/depth', { symbol, limit });
  return {
    bids: data.bids.map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
    asks: data.asks.map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
    ts: new Date(),
  };
}

async function getQuote({ instrument }) {
  const symbol = symbolFor(instrument);
  const data = await request('/api/v3/ticker/bookTicker', { symbol });
  return {
    bidPrice: Number(data.bidPrice),
    bidSize: Number(data.bidQty),
    askPrice: Number(data.askPrice),
    askSize: Number(data.askQty),
    ts: new Date(),
  };
}

function streamUrl(instrument) {
  const symbol = symbolFor(instrument).toLowerCase();
  return `wss://stream.binance.com:9443/stream?streams=${symbol}@depth20@100ms/${symbol}@trade`;
}

module.exports = { name: 'binance', getCandles, getOrderbook, getQuote, streamUrl, symbolFor, INTERVAL_MAP };
