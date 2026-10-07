const { closes, volumes, highs, lows, typicalPrices, mean } = require('./utils');

function obv(candles) {
  const c = closes(candles);
  const v = volumes(candles);
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    if (c[i] > c[i - 1]) out[i] = out[i - 1] + v[i];
    else if (c[i] < c[i - 1]) out[i] = out[i - 1] - v[i];
    else out[i] = out[i - 1];
  }
  return out;
}

// Chaikin Accumulation/Distribution line.
function adLine(candles) {
  const h = highs(candles);
  const l = lows(candles);
  const c = closes(candles);
  const v = volumes(candles);
  const out = new Array(candles.length).fill(0);
  let cum = 0;
  for (let i = 0; i < candles.length; i++) {
    const range = h[i] - l[i];
    const mfm = range === 0 ? 0 : ((c[i] - l[i]) - (h[i] - c[i])) / range;
    cum += mfm * v[i];
    out[i] = cum;
  }
  return out;
}

// Chaikin Money Flow: same money-flow-multiplier logic as A/D, but
// normalized over a rolling window instead of accumulated forever.
function cmf(candles, period = 20) {
  const h = highs(candles);
  const l = lows(candles);
  const c = closes(candles);
  const v = volumes(candles);
  const n = candles.length;
  const mfv = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const range = h[i] - l[i];
    const mfm = range === 0 ? 0 : ((c[i] - l[i]) - (h[i] - c[i])) / range;
    mfv[i] = mfm * v[i];
  }
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const sumMfv = mfv.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const sumVol = v.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    out[i] = sumVol === 0 ? 0 : sumMfv / sumVol;
  }
  return out;
}

// Latest volume vs. its own trailing average -- >1 means above-average activity.
function relativeVolume(candles, period = 20) {
  const v = volumes(candles);
  const n = candles.length;
  const out = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const avg = mean(v.slice(i - period, i));
    out[i] = avg === 0 ? null : v[i] / avg;
  }
  return out;
}

module.exports = { obv, adLine, cmf, relativeVolume };
