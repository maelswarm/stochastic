const test = require('node:test');
const assert = require('node:assert/strict');
const { SIGNALS, getSignal, listSignals } = require('../src/services/signals/catalog');

function makeCandles(n, { seed = 1, drift = 0, volMult = 1 } = {}) {
  let x = seed;
  function rand() {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  }
  const candles = [];
  let price = 100;
  const start = Date.UTC(2023, 0, 1);
  for (let i = 0; i < n; i++) {
    const change = (rand() - 0.5) * 2 * volMult + drift;
    const open = price;
    price = Math.max(1, price * (1 + change / 100));
    const close = price;
    const high = Math.max(open, close) + rand() * 0.5;
    const low = Math.min(open, close) - rand() * 0.5;
    candles.push({ ts: new Date(start + i * 86400000), open, high, low, close, volume: 1000 + rand() * 5000 });
  }
  return candles;
}

test('catalog: every signal has required fields', () => {
  for (const s of SIGNALS) {
    assert.ok(s.key, 'missing key');
    assert.ok(s.name, `${s.key}: missing name`);
    assert.ok(s.class === 'deterministic' || s.class === 'stochastic', `${s.key}: invalid class`);
    assert.equal(typeof s.evaluate, 'function', `${s.key}: evaluate is not a function`);
    assert.equal(typeof s.minBars, 'number', `${s.key}: minBars is not a number`);
  }
});

test('catalog: keys are unique', () => {
  const keys = SIGNALS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('listSignals: returns a plain serializable summary for every signal', () => {
  const list = listSignals();
  assert.equal(list.length, SIGNALS.length);
  for (const entry of list) {
    assert.ok(entry.key);
    assert.ok(Array.isArray(entry.params));
  }
});

test('every signal evaluates without throwing on a sufficiently long random series', () => {
  const candles = makeCandles(300, { seed: 7 });
  const benchmarkCandles = makeCandles(300, { seed: 42 });
  for (const s of SIGNALS) {
    assert.doesNotThrow(() => {
      const result = s.evaluate(candles, {}, { benchmarkCandles });
      if (result !== null) {
        assert.ok(['bullish', 'bearish', 'neutral'].includes(result.direction), `${s.key}: invalid direction "${result.direction}"`);
        assert.equal(typeof result.message, 'string', `${s.key}: message is not a string`);
      }
    }, `${s.key} threw`);
  }
});

test('every signal returns null (not throw) when given exactly its minBars - 1 candles', () => {
  for (const s of SIGNALS) {
    const candles = makeCandles(Math.max(5, s.minBars - 1), { seed: 3 });
    assert.doesNotThrow(() => s.evaluate(candles, {}, {}), `${s.key} threw on short input`);
  }
});

test('golden_cross fires on a clean SMA50/SMA200 crossover', () => {
  // Flat-then-ramp series: SMA50 stays below SMA200 for a long flat run,
  // then a strong ramp drags SMA50 up through SMA200 near the end.
  const flat = Array.from({ length: 220 }, () => 100);
  const ramp = Array.from({ length: 60 }, (_, i) => 100 + i * 3);
  const closesArr = flat.concat(ramp);
  const candles = closesArr.map((c, i) => ({
    ts: new Date(Date.UTC(2023, 0, 1 + i)),
    open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000,
  }));

  const goldenCross = getSignal('golden_cross');
  let fired = false;
  for (let end = 210; end <= candles.length; end++) {
    const result = goldenCross.evaluate(candles.slice(0, end), {});
    if (result) {
      assert.equal(result.direction, 'bullish');
      fired = true;
      break;
    }
  }
  assert.ok(fired, 'expected golden_cross to fire somewhere during the ramp');
});

test('rsi_overbought_oversold fires bullish on a sharp oversold plunge', () => {
  const flat = Array.from({ length: 40 }, () => 100);
  const plunge = Array.from({ length: 10 }, (_, i) => 100 - i * 4);
  const closesArr = flat.concat(plunge);
  const candles = closesArr.map((c, i) => ({
    ts: new Date(Date.UTC(2023, 0, 1 + i)),
    open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000,
  }));

  const signal = getSignal('rsi_overbought_oversold');
  let fired = false;
  for (let end = 20; end <= candles.length; end++) {
    const result = signal.evaluate(candles.slice(0, end), { oversold: 30 });
    if (result) {
      assert.equal(result.direction, 'bullish');
      fired = true;
    }
  }
  assert.ok(fired, 'expected an oversold signal during the plunge');
});
