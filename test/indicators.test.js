const test = require('node:test');
const assert = require('node:assert/strict');

const overlap = require('../src/services/indicators/overlap');
const momentum = require('../src/services/indicators/momentum');
const volatility = require('../src/services/indicators/volatility');
const volume = require('../src/services/indicators/volume');
const stats = require('../src/services/indicators/stats');

function makeCandles(closesArr, { highPad = 0.5, lowPad = 0.5, vol = 1000 } = {}) {
  return closesArr.map((c, i) => ({
    ts: new Date(Date.UTC(2024, 0, i + 1)),
    open: i === 0 ? c : closesArr[i - 1],
    high: c + highPad,
    low: c - lowPad,
    close: c,
    volume: vol,
  }));
}

// ---- overlap ---------------------------------------------------------------

test('sma: matches hand-computed values and pads warm-up with null', () => {
  const out = overlap.sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(out, [null, null, 2, 3, 4]);
});

test('ema: converges toward a constant series', () => {
  const flat = new Array(30).fill(10);
  const out = overlap.ema(flat, 10);
  const last = out[out.length - 1];
  assert.ok(Math.abs(last - 10) < 1e-6, `expected ema to converge to 10, got ${last}`);
});

test('bollinger: upper >= middle >= lower wherever defined', () => {
  const closesArr = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
  const { upper, middle, lower } = overlap.bollinger(closesArr, 20, 2);
  for (let i = 0; i < closesArr.length; i++) {
    if (upper[i] === null) continue;
    assert.ok(upper[i] >= middle[i] - 1e-9);
    assert.ok(middle[i] >= lower[i] - 1e-9);
  }
});

test('donchian: upper/lower bracket every close in the window', () => {
  const closesArr = [10, 12, 8, 15, 9, 11, 14, 7, 13, 10];
  const candles = makeCandles(closesArr);
  const { upper, lower } = overlap.donchian(candles, 5);
  for (let i = 4; i < candles.length; i++) {
    assert.ok(upper[i] >= candles[i].high - 1e-9);
    assert.ok(lower[i] <= candles[i].low + 1e-9);
  }
});

// ---- momentum ---------------------------------------------------------------

test('rsi: monotonically rising prices push RSI toward 100', () => {
  const closesArr = Array.from({ length: 30 }, (_, i) => 100 + i);
  const out = momentum.rsi(closesArr, 14);
  const last = out[out.length - 1];
  assert.ok(last > 95, `expected RSI near 100 for an unbroken uptrend, got ${last}`);
});

test('rsi: monotonically falling prices push RSI toward 0', () => {
  const closesArr = Array.from({ length: 30 }, (_, i) => 200 - i);
  const out = momentum.rsi(closesArr, 14);
  const last = out[out.length - 1];
  assert.ok(last < 5, `expected RSI near 0 for an unbroken downtrend, got ${last}`);
});

test('rsi: stays within [0, 100] on noisy data', () => {
  const closesArr = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10 + (i % 7));
  const out = momentum.rsi(closesArr, 14);
  for (const v of out) {
    if (v === null) continue;
    assert.ok(v >= 0 && v <= 100, `RSI out of range: ${v}`);
  }
});

test('macd: histogram equals macd line minus signal line at every defined index', () => {
  const closesArr = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8 + i * 0.2);
  const { macd, signal, histogram } = momentum.macd(closesArr, 12, 26, 9);
  for (let i = 0; i < closesArr.length; i++) {
    if (macd[i] === null || signal[i] === null) continue;
    assert.ok(Math.abs(histogram[i] - (macd[i] - signal[i])) < 1e-9);
  }
});

test('stochastic: %K stays within [0, 100]', () => {
  const closesArr = [10, 12, 8, 15, 9, 11, 14, 7, 13, 10, 16, 6, 12, 9, 15];
  const candles = makeCandles(closesArr);
  const { k } = momentum.stochastic(candles, 14, 1, 3);
  for (const v of k) {
    if (v === null) continue;
    assert.ok(v >= 0 && v <= 100);
  }
});

// ---- volatility ---------------------------------------------------------------

test('atr: always non-negative', () => {
  const closesArr = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 10);
  const candles = makeCandles(closesArr);
  const out = volatility.atr(candles, 14);
  for (const v of out) {
    if (v === null) continue;
    assert.ok(v >= 0);
  }
});

// ---- volume ---------------------------------------------------------------

test('obv: increases on an up bar and decreases on a down bar', () => {
  const candles = makeCandles([10, 11, 10.5]);
  const out = volume.obv(candles);
  assert.ok(out[1] > out[0]);
  assert.ok(out[2] < out[1]);
});

// ---- stats ---------------------------------------------------------------

test('correlation: a series with itself is 1, with its negation is -1', () => {
  const a = [1, 2, 3, 4, 5, 4, 3, 6, 2, 8];
  const b = a.map((v) => -v);
  assert.ok(Math.abs(stats.correlation(a, a) - 1) < 1e-9);
  assert.ok(Math.abs(stats.correlation(a, b) - -1) < 1e-9);
});

test('maxDrawdown: zero on a strictly increasing series', () => {
  const values = Array.from({ length: 20 }, (_, i) => 100 + i);
  const { maxDrawdown, currentDrawdown } = stats.maxDrawdown(values);
  assert.equal(maxDrawdown, 0);
  assert.equal(currentDrawdown, 0);
});

test('maxDrawdown: detects a known peak-to-trough decline', () => {
  const values = [100, 110, 120, 90, 95, 130];
  const { maxDrawdown } = stats.maxDrawdown(values);
  assert.ok(Math.abs(maxDrawdown - (120 - 90) / 120) < 1e-9);
});

test('sharpeRatio: null when returns have zero variance', () => {
  const returns = new Array(20).fill(0.01);
  assert.equal(stats.sharpeRatio(returns), null);
});

test('halfLifeOU: positive for a clearly mean-reverting synthetic series', () => {
  const values = [];
  let x = 5;
  for (let i = 0; i < 200; i++) {
    x = x * 0.9 + (Math.random() - 0.5) * 0.1; // strong pull toward 0
    values.push(x);
  }
  const halfLife = stats.halfLifeOU(values);
  assert.ok(halfLife !== null && halfLife > 0, `expected a positive half-life, got ${halfLife}`);
});

test('halfLifeOU: null for a non-reverting (trending) series', () => {
  const values = Array.from({ length: 100 }, (_, i) => 10 + i * 2);
  assert.equal(stats.halfLifeOU(values), null);
});

test('hurstExponent: finite and within a sane range for a random walk', () => {
  const values = [100];
  for (let i = 0; i < 300; i++) values.push(values[values.length - 1] + (Math.random() - 0.5));
  const h = stats.hurstExponent(values);
  assert.ok(h !== null);
  assert.ok(h > -0.5 && h < 1.5, `Hurst estimate out of sane range: ${h}`);
});

test('zScoreSeries: 0 when the rolling window is constant', () => {
  const values = new Array(25).fill(42);
  const out = stats.zScoreSeries(values, 20);
  assert.equal(out[24], 0);
});
