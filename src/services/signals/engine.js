// Runs the signal catalog against closed bars for a given instrument +
// timeframe's active alert rules. Pure orchestration -- all the actual math
// lives in indicators/* and each signal's evaluate() in catalog.js.
const candlesRepo = require('../../db/repositories/candles.repo');
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const { getSignal } = require('./catalog');

async function loadBenchmarkCandles(instrument, timeframe) {
  if (instrument.symbol === 'SPY' && instrument.asset_class === 'stock') return null;
  if (instrument.asset_class !== 'stock') return null;
  const spy = await instrumentsRepo.findBySymbol('SPY', 'stock');
  if (!spy) return null;
  return candlesRepo.getLatest(spy.id, timeframe, 400);
}

// rules: alert_rules rows already filtered to this (instrument, timeframe).
// Returns an array of { rule, result, barTs } for every rule whose signal
// fired on the latest closed bar.
async function evaluateRules(instrument, timeframe, rules) {
  if (rules.length === 0) return [];

  const candles = await candlesRepo.getLatest(instrument.id, timeframe, 400);
  if (candles.length === 0) return [];
  const barTs = candles[candles.length - 1].ts;

  const needsBenchmark = rules.some((r) => {
    const def = getSignal(r.signal_key);
    return def && def.requiresBenchmark;
  });
  const benchmarkCandles = needsBenchmark ? await loadBenchmarkCandles(instrument, timeframe) : null;

  const detections = [];
  for (const rule of rules) {
    const def = getSignal(rule.signal_key);
    if (!def) continue;
    if (candles.length < def.minBars) continue;

    let result;
    try {
      result = def.evaluate(candles, rule.params || {}, { benchmarkCandles });
    } catch (err) {
      console.error(`[signals] ${rule.signal_key} threw for instrument ${instrument.symbol}:`, err);
      continue;
    }
    if (result) detections.push({ rule, result, barTs });
  }
  return detections;
}

module.exports = { evaluateRules };
