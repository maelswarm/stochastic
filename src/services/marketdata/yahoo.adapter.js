// Yahoo Finance's unofficial v8 chart endpoint -- the only free source for
// futures continuous contracts (ES=F, GC=F, CL=F, ...). Keyless, but
// undocumented and can change/break without notice, so this adapter is
// only ever reached when ENABLE_YAHOO_ADAPTER=true (env.js) and its
// failures degrade just the futures asset class, never the whole app.
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const INTERVAL_MAP = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '60m',
  '4h': '60m', // Yahoo has no native 4h bucket; caller gets 60m and aggregates if needed
  '1D': '1d',
  '1W': '1wk',
};

const RANGE_MAP = {
  '1m': '5d',
  '5m': '1mo',
  '15m': '1mo',
  '1h': '2y',
  '4h': '2y',
  '1D': '10y',
  '1W': 'max',
};

function symbolFor(instrument) {
  return (instrument.provider_symbols && instrument.provider_symbols.yahoo) || instrument.symbol;
}

async function getCandles({ instrument, timeframe }) {
  const symbol = symbolFor(instrument);
  const url = new URL(`${BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', INTERVAL_MAP[timeframe]);
  url.searchParams.set('range', RANGE_MAP[timeframe]);

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; stochastic-dashboard/1.0)' } });
  if (!res.ok) throw new Error(`Yahoo chart error ${res.status}`);
  const data = await res.json();

  const result = data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error((data.chart && data.chart.error && data.chart.error.description) || 'Yahoo: no data');

  const ts = result.timestamp || [];
  const quote = result.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (quote.close[i] == null) continue;
    bars.push({
      ts: new Date(ts[i] * 1000),
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
      volume: quote.volume[i] || 0,
    });
  }
  return bars;
}

module.exports = { name: 'yahoo', getCandles, symbolFor };
