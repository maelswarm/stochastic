const { mean, stddev, rollingApply, typicalPrices, volumes, highs, lows, closes, trueRange } = require('./utils');
const { atr } = require('./volatility');

function sma(values, period) {
  return rollingApply(values, period, (window) => mean(window));
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null || values[i] === undefined) continue;
    if (prev === null) {
      if (i >= period - 1) {
        prev = mean(values.slice(i - period + 1, i + 1));
        out[i] = prev;
      }
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function wma(values, period) {
  const denom = (period * (period + 1)) / 2;
  return rollingApply(values, period, (window) => {
    let sum = 0;
    for (let i = 0; i < window.length; i++) sum += window[i] * (i + 1);
    return sum / denom;
  });
}

// Cumulative VWAP across the whole supplied series (an approximation of the
// usual session-reset VWAP -- fine for the metrics grid, which only reads
// the latest value as "distance from VWAP" over the visible window).
function vwap(candles) {
  const tp = typicalPrices(candles);
  const vol = volumes(candles);
  const out = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    cumPV += tp[i] * vol[i];
    cumV += vol[i];
    out[i] = cumV > 0 ? cumPV / cumV : null;
  }
  return out;
}

function bollinger(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  const bandwidth = new Array(values.length).fill(null);
  const percentB = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const sd = stddev(window, 0);
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
    bandwidth[i] = middle[i] !== 0 ? (upper[i] - lower[i]) / middle[i] : null;
    percentB[i] = upper[i] !== lower[i] ? (values[i] - lower[i]) / (upper[i] - lower[i]) : null;
  }
  return { upper, middle, lower, bandwidth, percentB };
}

function keltner(candles, period = 20, atrMult = 1.5) {
  const closeArr = closes(candles);
  const middle = ema(closeArr, period);
  const atrArr = atr(candles, period);
  const upper = middle.map((m, i) => (m !== null && atrArr[i] !== null ? m + atrMult * atrArr[i] : null));
  const lower = middle.map((m, i) => (m !== null && atrArr[i] !== null ? m - atrMult * atrArr[i] : null));
  return { upper, middle, lower };
}

function donchian(candles, period = 20) {
  const h = highs(candles);
  const l = lows(candles);
  const upper = rollingApply(h, period, (w) => Math.max(...w));
  const lower = rollingApply(l, period, (w) => Math.min(...w));
  const middle = upper.map((u, i) => (u !== null && lower[i] !== null ? (u + lower[i]) / 2 : null));
  return { upper, middle, lower };
}

// Wilder's Parabolic SAR. trend: 1 = uptrend, -1 = downtrend.
function parabolicSar(candles, step = 0.02, maxStep = 0.2) {
  const n = candles.length;
  const sar = new Array(n).fill(null);
  const trend = new Array(n).fill(null);
  if (n < 2) return { sar, trend };

  let isUp = candles[1].close >= candles[0].close;
  let af = step;
  let ep = isUp ? candles[0].high : candles[0].low;
  let sarVal = isUp ? candles[0].low : candles[0].high;
  sar[0] = sarVal;
  trend[0] = isUp ? 1 : -1;

  for (let i = 1; i < n; i++) {
    sarVal = sarVal + af * (ep - sarVal);
    const c = candles[i];
    const prev1 = candles[i - 1];
    const prev2 = candles[i - 2] || candles[i - 1];

    if (isUp) {
      sarVal = Math.min(sarVal, prev1.low, prev2.low);
      if (c.low < sarVal) {
        isUp = false;
        sarVal = ep;
        ep = c.low;
        af = step;
      } else {
        if (c.high > ep) { ep = c.high; af = Math.min(af + step, maxStep); }
      }
    } else {
      sarVal = Math.max(sarVal, prev1.high, prev2.high);
      if (c.high > sarVal) {
        isUp = true;
        sarVal = ep;
        ep = c.high;
        af = step;
      } else {
        if (c.low < ep) { ep = c.low; af = Math.min(af + step, maxStep); }
      }
    }

    sar[i] = sarVal;
    trend[i] = isUp ? 1 : -1;
  }
  return { sar, trend };
}

// Supertrend. trend: 1 = uptrend (line below price), -1 = downtrend.
function supertrend(candles, period = 10, mult = 3) {
  const n = candles.length;
  const atrArr = atr(candles, period);
  const hl2 = candles.map((c) => (c.high + c.low) / 2);
  const upperBasic = new Array(n).fill(null);
  const lowerBasic = new Array(n).fill(null);
  const value = new Array(n).fill(null);
  const trend = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (atrArr[i] === null) continue;
    upperBasic[i] = hl2[i] + mult * atrArr[i];
    lowerBasic[i] = hl2[i] - mult * atrArr[i];
  }

  let upperFinal = null;
  let lowerFinal = null;
  let isUp = true;

  for (let i = 0; i < n; i++) {
    if (upperBasic[i] === null) continue;
    const prevClose = i > 0 ? candles[i - 1].close : candles[i].close;

    upperFinal = upperFinal === null || upperBasic[i] < upperFinal || prevClose > upperFinal ? upperBasic[i] : upperFinal;
    lowerFinal = lowerFinal === null || lowerBasic[i] > lowerFinal || prevClose < lowerFinal ? lowerBasic[i] : lowerFinal;

    if (candles[i].close > upperFinal) isUp = true;
    else if (candles[i].close < lowerFinal) isUp = false;

    value[i] = isUp ? lowerFinal : upperFinal;
    trend[i] = isUp ? 1 : -1;
  }

  return { value, trend };
}

function ichimoku(candles, conversionPeriod = 9, basePeriod = 26, spanBPeriod = 52, displacement = 26) {
  const h = highs(candles);
  const l = lows(candles);
  const c = closes(candles);
  const n = candles.length;

  const midpoint = (period, i) => {
    if (i < period - 1) return null;
    const hh = Math.max(...h.slice(i - period + 1, i + 1));
    const ll = Math.min(...l.slice(i - period + 1, i + 1));
    return (hh + ll) / 2;
  };

  const tenkan = new Array(n).fill(null);
  const kijun = new Array(n).fill(null);
  const spanBRaw = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    tenkan[i] = midpoint(conversionPeriod, i);
    kijun[i] = midpoint(basePeriod, i);
    spanBRaw[i] = midpoint(spanBPeriod, i);
  }

  // Span A/B are plotted `displacement` bars into the future; chikou is
  // plotted `displacement` bars into the past -- represented here as
  // index-shifted arrays of the same length as the input.
  const spanA = new Array(n).fill(null);
  const spanB = new Array(n).fill(null);
  const chikou = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (tenkan[i] !== null && kijun[i] !== null) {
      const target = i + displacement;
      if (target < n) spanA[target] = (tenkan[i] + kijun[i]) / 2;
    }
    if (spanBRaw[i] !== null) {
      const target = i + displacement;
      if (target < n) spanB[target] = spanBRaw[i];
    }
    if (i - displacement >= 0) chikou[i - displacement] = c[i];
  }

  return { tenkan, kijun, spanA, spanB, chikou };
}

module.exports = { sma, ema, wma, vwap, bollinger, keltner, donchian, parabolicSar, supertrend, ichimoku };
