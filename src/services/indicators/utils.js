// Shared helpers for the indicator library. Every indicator takes plain
// number arrays (or candle objects) and returns arrays the same length as
// the input, padded with `null` during the warm-up window -- that keeps
// series index-aligned with the source candles, which both chart overlays
// and the signal engine (crossovers on the last two bars) rely on.

function closes(candles) { return candles.map((c) => c.close); }
function opens(candles) { return candles.map((c) => c.open); }
function highs(candles) { return candles.map((c) => c.high); }
function lows(candles) { return candles.map((c) => c.low); }
function volumes(candles) { return candles.map((c) => c.volume); }
function typicalPrices(candles) { return candles.map((c) => (c.high + c.low + c.close) / 3); }
function medianPrices(candles) { return candles.map((c) => (c.high + c.low) / 2); }

function mean(arr) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Effectively-zero threshold for values that should be mathematically zero
// (e.g. stddev of a constant series) but pick up floating-point summation
// noise -- without this, near-constant inputs produce a spuriously tiny
// nonzero denominator instead of zero, and ratios that divide by it
// (Sharpe, z-score, ...) blow up to nonsense instead of reading as flat/null.
const EPSILON = 1e-9;

function stddev(arr, ddof = 0) {
  const n = arr.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(arr);
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (n - ddof);
  // Guards against a tiny negative variance from fp rounding, which would
  // otherwise make sqrt() return NaN instead of ~0.
  return Math.sqrt(Math.max(0, variance));
}

function rollingApply(values, period, fn) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    out[i] = fn(values.slice(i - period + 1, i + 1), i);
  }
  return out;
}

function diff(values) {
  const out = new Array(values.length).fill(null);
  for (let i = 1; i < values.length; i++) out[i] = values[i] - values[i - 1];
  return out;
}

// Simple returns (r_t = p_t/p_{t-1} - 1), first entry null.
function pctReturns(values) {
  const out = new Array(values.length).fill(null);
  for (let i = 1; i < values.length; i++) out[i] = values[i - 1] === 0 ? null : values[i] / values[i - 1] - 1;
  return out;
}

function logReturns(values) {
  const out = new Array(values.length).fill(null);
  for (let i = 1; i < values.length; i++) out[i] = values[i - 1] > 0 && values[i] > 0 ? Math.log(values[i] / values[i - 1]) : null;
  return out;
}

function trueRange(candles) {
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      out[i] = c.high - c.low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    out[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }
  return out;
}

function dropNulls(arr) {
  return arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
}

function lastValid(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined && !Number.isNaN(arr[i])) return arr[i];
  }
  return null;
}

module.exports = {
  closes, opens, highs, lows, volumes, typicalPrices, medianPrices,
  mean, stddev, rollingApply, diff, pctReturns, logReturns, trueRange,
  dropNulls, lastValid, EPSILON,
};
