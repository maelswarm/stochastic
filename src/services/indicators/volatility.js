const { closes, highs, lows, opens, mean, stddev, rollingApply, trueRange, logReturns } = require('./utils');

// Wilder's ATR: seeded with a simple mean of the first `period` true
// ranges, then smoothed -- the standard formulation (not a plain SMA of TR).
function atr(candles, period = 14) {
  const tr = trueRange(candles);
  const out = new Array(candles.length).fill(null);
  let prev = null;
  for (let i = 0; i < candles.length; i++) {
    if (tr[i] === null) continue;
    if (prev === null) {
      if (i >= period - 1) {
        prev = mean(tr.slice(i - period + 1, i + 1));
        out[i] = prev;
      }
      continue;
    }
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

function atrPercent(candles, period = 14) {
  const atrArr = atr(candles, period);
  return atrArr.map((v, i) => (v !== null ? (v / candles[i].close) * 100 : null));
}

function rollingStddev(values, period, ddof = 1) {
  return rollingApply(values, period, (window) => stddev(window, ddof));
}

// Annualized realized volatility from log returns: stdev(returns) * sqrt(N).
function realizedVol(values, period, annualizationFactor = 252) {
  const rets = logReturns(values);
  const out = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    const window = rets.slice(i - period + 1, i + 1).filter((v) => v !== null);
    if (window.length < period - 1) continue;
    out[i] = stddev(window, 1) * Math.sqrt(annualizationFactor);
  }
  return out;
}

// Parkinson volatility estimator (uses high/low range, more efficient than
// close-to-close for the same sample size). Annualized.
function parkinsonVol(candles, period = 20, annualizationFactor = 252) {
  const h = highs(candles);
  const l = lows(candles);
  const n = candles.length;
  const out = new Array(n).fill(null);
  const factor = 1 / (4 * Math.log(2));
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += factor * Math.log(h[j] / l[j]) ** 2;
    out[i] = Math.sqrt((sum / period) * annualizationFactor);
  }
  return out;
}

// Garman-Klass volatility estimator (uses OHLC, more efficient still).
function garmanKlassVol(candles, period = 20, annualizationFactor = 252) {
  const o = opens(candles);
  const h = highs(candles);
  const l = lows(candles);
  const c = closes(candles);
  const n = candles.length;
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const hl = 0.5 * Math.log(h[j] / l[j]) ** 2;
      const co = (2 * Math.log(2) - 1) * Math.log(c[j] / o[j]) ** 2;
      sum += hl - co;
    }
    const variance = sum / period;
    out[i] = variance > 0 ? Math.sqrt(variance * annualizationFactor) : 0;
  }
  return out;
}

module.exports = { atr, atrPercent, rollingStddev, realizedVol, parkinsonVol, garmanKlassVol };
