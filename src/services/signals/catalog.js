// Signal catalog: every entry is a pure function over closed candles that
// fires only when the transition happens on the most recent bar. The
// alert-rule UI (public/js/dashboard/modules/alerts.js) is generated from
// this list, so `key`/`name`/`class`/`params` double as the API contract.
const { closes, highs, lows, volumes } = require('../indicators/utils');
const overlap = require('../indicators/overlap');
const momentum = require('../indicators/momentum');
const volatility = require('../indicators/volatility');
const volume = require('../indicators/volume');
const stats = require('../indicators/stats');
const {
  crossesAboveLevel, crossesBelowLevel, seriesCrossesAbove, seriesCrossesBelow,
  flippedTo, last, valid,
} = require('./crossings');

function fmt(x, decimals = 2) {
  return x === null || x === undefined ? 'n/a' : Number(x).toFixed(decimals);
}

const SIGNALS = [];
function define(entry) { SIGNALS.push(entry); }

// ============================================================ deterministic

define({
  key: 'golden_cross',
  name: 'Golden Cross (SMA50 ↑ SMA200)',
  class: 'deterministic',
  params: [],
  minBars: 210,
  evaluate(candles) {
    const c = closes(candles);
    const fast = overlap.sma(c, 50);
    const slow = overlap.sma(c, 200);
    if (!seriesCrossesAbove(fast, slow)) return null;
    return { direction: 'bullish', message: `SMA50 (${fmt(last(fast))}) crossed above SMA200 (${fmt(last(slow))}).`, values: { sma50: last(fast), sma200: last(slow) } };
  },
});

define({
  key: 'death_cross',
  name: 'Death Cross (SMA50 ↓ SMA200)',
  class: 'deterministic',
  params: [],
  minBars: 210,
  evaluate(candles) {
    const c = closes(candles);
    const fast = overlap.sma(c, 50);
    const slow = overlap.sma(c, 200);
    if (!seriesCrossesBelow(fast, slow)) return null;
    return { direction: 'bearish', message: `SMA50 (${fmt(last(fast))}) crossed below SMA200 (${fmt(last(slow))}).`, values: { sma50: last(fast), sma200: last(slow) } };
  },
});

define({
  key: 'price_sma_cross',
  name: 'Price / SMA cross',
  class: 'deterministic',
  params: [{ name: 'period', type: 'number', default: 20, min: 5, max: 300 }],
  minBars: 30,
  evaluate(candles, { period = 20 } = {}) {
    const c = closes(candles);
    const smaArr = overlap.sma(c, period);
    if (seriesCrossesAbove(c, smaArr)) {
      return { direction: 'bullish', message: `Price crossed above SMA${period} (${fmt(last(smaArr))}).`, values: { sma: last(smaArr) } };
    }
    if (seriesCrossesBelow(c, smaArr)) {
      return { direction: 'bearish', message: `Price crossed below SMA${period} (${fmt(last(smaArr))}).`, values: { sma: last(smaArr) } };
    }
    return null;
  },
});

define({
  key: 'macd_signal_cross',
  name: 'MACD signal-line cross',
  class: 'deterministic',
  params: [],
  minBars: 60,
  evaluate(candles) {
    const c = closes(candles);
    const { macd, signal } = momentum.macd(c);
    if (seriesCrossesAbove(macd, signal)) return { direction: 'bullish', message: `MACD crossed above its signal line.`, values: { macd: last(macd), signal: last(signal) } };
    if (seriesCrossesBelow(macd, signal)) return { direction: 'bearish', message: `MACD crossed below its signal line.`, values: { macd: last(macd), signal: last(signal) } };
    return null;
  },
});

define({
  key: 'macd_zero_cross',
  name: 'MACD zero-line cross',
  class: 'deterministic',
  params: [],
  minBars: 60,
  evaluate(candles) {
    const c = closes(candles);
    const { macd } = momentum.macd(c);
    if (crossesAboveLevel(macd, 0)) return { direction: 'bullish', message: 'MACD crossed above zero.', values: { macd: last(macd) } };
    if (crossesBelowLevel(macd, 0)) return { direction: 'bearish', message: 'MACD crossed below zero.', values: { macd: last(macd) } };
    return null;
  },
});

define({
  key: 'rsi_overbought_oversold',
  name: 'RSI overbought / oversold',
  class: 'deterministic',
  params: [{ name: 'overbought', type: 'number', default: 70, min: 50, max: 95 }, { name: 'oversold', type: 'number', default: 30, min: 5, max: 50 }],
  minBars: 30,
  evaluate(candles, { overbought = 70, oversold = 30 } = {}) {
    const rsi = momentum.rsi(closes(candles), 14);
    if (crossesAboveLevel(rsi, overbought)) return { direction: 'bearish', message: `RSI entered overbought territory (${fmt(last(rsi))}).`, values: { rsi: last(rsi) } };
    if (crossesBelowLevel(rsi, oversold)) return { direction: 'bullish', message: `RSI entered oversold territory (${fmt(last(rsi))}).`, values: { rsi: last(rsi) } };
    return null;
  },
});

define({
  key: 'rsi_midline_cross',
  name: 'RSI 50-midline cross',
  class: 'deterministic',
  params: [],
  minBars: 30,
  evaluate(candles) {
    const rsi = momentum.rsi(closes(candles), 14);
    if (crossesAboveLevel(rsi, 50)) return { direction: 'bullish', message: 'RSI crossed above 50.', values: { rsi: last(rsi) } };
    if (crossesBelowLevel(rsi, 50)) return { direction: 'bearish', message: 'RSI crossed below 50.', values: { rsi: last(rsi) } };
    return null;
  },
});

define({
  key: 'bollinger_band_touch',
  name: 'Bollinger Band touch/break',
  class: 'deterministic',
  params: [{ name: 'period', type: 'number', default: 20 }, { name: 'mult', type: 'number', default: 2 }],
  minBars: 30,
  evaluate(candles, { period = 20, mult = 2 } = {}) {
    const c = closes(candles);
    const { upper, lower } = overlap.bollinger(c, period, mult);
    if (crossesAboveLevel(c, last(upper, 1))) return { direction: 'bearish', message: `Price broke above the upper Bollinger Band (${fmt(last(upper))}).`, values: { upper: last(upper) } };
    if (crossesBelowLevel(c, last(lower, 1))) return { direction: 'bullish', message: `Price broke below the lower Bollinger Band (${fmt(last(lower))}).`, values: { lower: last(lower) } };
    return null;
  },
});

define({
  key: 'bollinger_squeeze_release',
  name: 'Bollinger squeeze release',
  class: 'deterministic',
  params: [{ name: 'period', type: 'number', default: 20 }, { name: 'lookback', type: 'number', default: 120 }],
  minBars: 150,
  evaluate(candles, { period = 20, lookback = 120 } = {}) {
    const c = closes(candles);
    const { bandwidth } = overlap.bollinger(c, period, 2);
    const window = bandwidth.slice(-lookback).filter(valid);
    if (window.length < 30) return null;
    const sorted = [...window].sort((a, b) => a - b);
    const p20 = sorted[Math.floor(sorted.length * 0.2)];
    const bw = last(bandwidth);
    const bwPrev = last(bandwidth, 1);
    if (bwPrev !== null && bwPrev <= p20 && bw > p20) {
      return { direction: 'neutral', message: `Bollinger squeeze released (bandwidth ${fmt(bw, 3)} vs 20th pct ${fmt(p20, 3)}).`, values: { bandwidth: bw } };
    }
    return null;
  },
});

define({
  key: 'donchian_breakout',
  name: 'Donchian channel breakout',
  class: 'deterministic',
  params: [{ name: 'period', type: 'number', default: 20, min: 5, max: 100 }],
  minBars: 40,
  evaluate(candles, { period = 20 } = {}) {
    const c = closes(candles);
    const { upper, lower } = overlap.donchian(candles, period);
    if (crossesAboveLevel(c, last(upper, 1))) return { direction: 'bullish', message: `New ${period}-bar high breakout (${fmt(last(upper))}).`, values: { upper: last(upper) } };
    if (crossesBelowLevel(c, last(lower, 1))) return { direction: 'bearish', message: `New ${period}-bar low breakdown (${fmt(last(lower))}).`, values: { lower: last(lower) } };
    return null;
  },
});

define({
  key: 'parabolic_sar_flip',
  name: 'Parabolic SAR flip',
  class: 'deterministic',
  params: [],
  minBars: 20,
  evaluate(candles) {
    const { trend, sar } = overlap.parabolicSar(candles);
    if (flippedTo(trend, 1)) return { direction: 'bullish', message: `Parabolic SAR flipped bullish (${fmt(last(sar))}).`, values: { sar: last(sar) } };
    if (flippedTo(trend, -1)) return { direction: 'bearish', message: `Parabolic SAR flipped bearish (${fmt(last(sar))}).`, values: { sar: last(sar) } };
    return null;
  },
});

define({
  key: 'supertrend_flip',
  name: 'Supertrend flip',
  class: 'deterministic',
  params: [{ name: 'period', type: 'number', default: 10 }, { name: 'mult', type: 'number', default: 3 }],
  minBars: 30,
  evaluate(candles, { period = 10, mult = 3 } = {}) {
    const { trend, value } = overlap.supertrend(candles, period, mult);
    if (flippedTo(trend, 1)) return { direction: 'bullish', message: `Supertrend flipped bullish (${fmt(last(value))}).`, values: { supertrend: last(value) } };
    if (flippedTo(trend, -1)) return { direction: 'bearish', message: `Supertrend flipped bearish (${fmt(last(value))}).`, values: { supertrend: last(value) } };
    return null;
  },
});

define({
  key: 'ichimoku_tk_cross',
  name: 'Ichimoku Tenkan/Kijun cross',
  class: 'deterministic',
  params: [],
  minBars: 80,
  evaluate(candles) {
    const { tenkan, kijun } = overlap.ichimoku(candles);
    if (seriesCrossesAbove(tenkan, kijun)) return { direction: 'bullish', message: 'Tenkan-sen crossed above Kijun-sen.', values: { tenkan: last(tenkan), kijun: last(kijun) } };
    if (seriesCrossesBelow(tenkan, kijun)) return { direction: 'bearish', message: 'Tenkan-sen crossed below Kijun-sen.', values: { tenkan: last(tenkan), kijun: last(kijun) } };
    return null;
  },
});

define({
  key: 'ichimoku_cloud_break',
  name: 'Ichimoku cloud breakout',
  class: 'deterministic',
  params: [],
  minBars: 80,
  evaluate(candles) {
    const c = closes(candles);
    const { spanA, spanB } = overlap.ichimoku(candles);
    const n = candles.length;
    if (spanA[n - 1] === null || spanB[n - 1] === null || spanA[n - 2] === null || spanB[n - 2] === null) return null;
    const cloudTop = (i) => Math.max(spanA[i], spanB[i]);
    const cloudBottom = (i) => Math.min(spanA[i], spanB[i]);
    if (c[n - 2] <= cloudTop(n - 2) && c[n - 1] > cloudTop(n - 1)) {
      return { direction: 'bullish', message: 'Price broke above the Ichimoku cloud.', values: { cloudTop: cloudTop(n - 1) } };
    }
    if (c[n - 2] >= cloudBottom(n - 2) && c[n - 1] < cloudBottom(n - 1)) {
      return { direction: 'bearish', message: 'Price broke below the Ichimoku cloud.', values: { cloudBottom: cloudBottom(n - 1) } };
    }
    return null;
  },
});

define({
  key: 'adx_di_cross',
  name: 'ADX/DMI +DI / -DI cross',
  class: 'deterministic',
  params: [{ name: 'adxThreshold', type: 'number', default: 20 }],
  minBars: 40,
  evaluate(candles, { adxThreshold = 20 } = {}) {
    const { adx, plusDI, minusDI } = momentum.adx(candles, 14);
    const strong = last(adx) !== null && last(adx) >= adxThreshold;
    if (!strong) return null;
    if (seriesCrossesAbove(plusDI, minusDI)) return { direction: 'bullish', message: `+DI crossed above -DI with ADX ${fmt(last(adx), 1)}.`, values: { adx: last(adx) } };
    if (seriesCrossesBelow(plusDI, minusDI)) return { direction: 'bearish', message: `-DI crossed above +DI with ADX ${fmt(last(adx), 1)}.`, values: { adx: last(adx) } };
    return null;
  },
});

define({
  key: 'cci_cross',
  name: 'CCI ±100 cross',
  class: 'deterministic',
  params: [],
  minBars: 30,
  evaluate(candles) {
    const cci = momentum.cci(candles, 20);
    if (crossesAboveLevel(cci, 100)) return { direction: 'bullish', message: `CCI crossed above 100 (${fmt(last(cci))}).`, values: { cci: last(cci) } };
    if (crossesBelowLevel(cci, -100)) return { direction: 'bearish', message: `CCI crossed below -100 (${fmt(last(cci))}).`, values: { cci: last(cci) } };
    return null;
  },
});

define({
  key: 'roc_zero_cross',
  name: 'Rate of Change zero cross',
  class: 'deterministic',
  params: [{ name: 'period', type: 'number', default: 12 }],
  minBars: 30,
  evaluate(candles, { period = 12 } = {}) {
    const roc = momentum.roc(closes(candles), period);
    if (crossesAboveLevel(roc, 0)) return { direction: 'bullish', message: `ROC crossed above zero (${fmt(last(roc))}).`, values: { roc: last(roc) } };
    if (crossesBelowLevel(roc, 0)) return { direction: 'bearish', message: `ROC crossed below zero (${fmt(last(roc))}).`, values: { roc: last(roc) } };
    return null;
  },
});

define({
  key: 'awesome_oscillator_zero_cross',
  name: 'Awesome Oscillator zero cross',
  class: 'deterministic',
  params: [],
  minBars: 50,
  evaluate(candles) {
    const ao = momentum.awesomeOscillator(candles);
    if (crossesAboveLevel(ao, 0)) return { direction: 'bullish', message: 'Awesome Oscillator crossed above zero.', values: { ao: last(ao) } };
    if (crossesBelowLevel(ao, 0)) return { direction: 'bearish', message: 'Awesome Oscillator crossed below zero.', values: { ao: last(ao) } };
    return null;
  },
});

define({
  key: 'volume_spike',
  name: 'Volume spike',
  class: 'deterministic',
  params: [{ name: 'multiple', type: 'number', default: 3, min: 1.5, max: 10 }],
  minBars: 25,
  evaluate(candles, { multiple = 3 } = {}) {
    const relVol = volume.relativeVolume(candles, 20);
    const v = last(relVol);
    if (v !== null && v >= multiple) {
      return { direction: 'neutral', message: `Volume is ${fmt(v, 1)}× the 20-bar average.`, values: { relativeVolume: v } };
    }
    return null;
  },
});

define({
  key: 'obv_breakout',
  name: 'OBV breakout',
  class: 'deterministic',
  params: [{ name: 'period', type: 'number', default: 20 }],
  minBars: 30,
  evaluate(candles, { period = 20 } = {}) {
    const obv = volume.obv(candles);
    const window = obv.slice(-period - 1, -1);
    const hh = Math.max(...window);
    const ll = Math.min(...window);
    if (last(obv) > hh) return { direction: 'bullish', message: 'On-Balance Volume broke out to a new high.', values: { obv: last(obv) } };
    if (last(obv) < ll) return { direction: 'bearish', message: 'On-Balance Volume broke down to a new low.', values: { obv: last(obv) } };
    return null;
  },
});

define({
  key: 'cmf_sign_flip',
  name: 'Chaikin Money Flow sign flip',
  class: 'deterministic',
  params: [{ name: 'period', type: 'number', default: 20 }],
  minBars: 30,
  evaluate(candles, { period = 20 } = {}) {
    const cmf = volume.cmf(candles, period);
    if (crossesAboveLevel(cmf, 0)) return { direction: 'bullish', message: 'Chaikin Money Flow turned positive.', values: { cmf: last(cmf) } };
    if (crossesBelowLevel(cmf, 0)) return { direction: 'bearish', message: 'Chaikin Money Flow turned negative.', values: { cmf: last(cmf) } };
    return null;
  },
});

define({
  key: 'mfi_overbought_oversold',
  name: 'Money Flow Index overbought/oversold',
  class: 'deterministic',
  params: [{ name: 'overbought', type: 'number', default: 80 }, { name: 'oversold', type: 'number', default: 20 }],
  minBars: 30,
  evaluate(candles, { overbought = 80, oversold = 20 } = {}) {
    const mfi = momentum.mfi(candles, 14);
    if (crossesAboveLevel(mfi, overbought)) return { direction: 'bearish', message: `MFI entered overbought territory (${fmt(last(mfi))}).`, values: { mfi: last(mfi) } };
    if (crossesBelowLevel(mfi, oversold)) return { direction: 'bullish', message: `MFI entered oversold territory (${fmt(last(mfi))}).`, values: { mfi: last(mfi) } };
    return null;
  },
});

define({
  key: 'vwap_cross',
  name: 'VWAP cross',
  class: 'deterministic',
  params: [],
  minBars: 25,
  evaluate(candles) {
    const c = closes(candles);
    const vwapArr = overlap.vwap(candles.slice(-60));
    const padded = new Array(candles.length - vwapArr.length).fill(null).concat(vwapArr);
    if (seriesCrossesAbove(c, padded)) return { direction: 'bullish', message: `Price crossed above VWAP (${fmt(last(padded))}).`, values: { vwap: last(padded) } };
    if (seriesCrossesBelow(c, padded)) return { direction: 'bearish', message: `Price crossed below VWAP (${fmt(last(padded))}).`, values: { vwap: last(padded) } };
    return null;
  },
});

define({
  key: 'new_52w_extreme',
  name: '52-week high/low break',
  class: 'deterministic',
  params: [],
  minBars: 260,
  evaluate(candles) {
    const h = highs(candles);
    const l = lows(candles);
    const c = closes(candles);
    const n = candles.length;
    const windowH = h.slice(Math.max(0, n - 253), n - 1);
    const windowL = l.slice(Math.max(0, n - 253), n - 1);
    if (windowH.length < 200) return null;
    if (c[n - 1] > Math.max(...windowH)) return { direction: 'bullish', message: 'New 52-week high.', values: { close: c[n - 1] } };
    if (c[n - 1] < Math.min(...windowL)) return { direction: 'bearish', message: 'New 52-week low.', values: { close: c[n - 1] } };
    return null;
  },
});

define({
  key: 'gap_move',
  name: 'Gap up/down',
  class: 'deterministic',
  params: [{ name: 'thresholdPct', type: 'number', default: 2, min: 0.5, max: 15 }],
  minBars: 5,
  evaluate(candles, { thresholdPct = 2 } = {}) {
    const n = candles.length;
    if (n < 2) return null;
    const prevClose = candles[n - 2].close;
    const openToday = candles[n - 1].open;
    const gapPct = ((openToday - prevClose) / prevClose) * 100;
    if (gapPct >= thresholdPct) return { direction: 'bullish', message: `Gapped up ${fmt(gapPct, 1)}% at the open.`, values: { gapPct } };
    if (gapPct <= -thresholdPct) return { direction: 'bearish', message: `Gapped down ${fmt(gapPct, 1)}% at the open.`, values: { gapPct } };
    return null;
  },
});

define({
  key: 'bullish_engulfing',
  name: 'Bullish engulfing candle',
  class: 'deterministic',
  params: [],
  minBars: 5,
  evaluate(candles) {
    const n = candles.length;
    const prev = candles[n - 2];
    const cur = candles[n - 1];
    const prevBearish = prev.close < prev.open;
    const curBullish = cur.close > cur.open;
    if (prevBearish && curBullish && cur.open <= prev.close && cur.close >= prev.open) {
      return { direction: 'bullish', message: 'Bullish engulfing candle formed.', values: {} };
    }
    return null;
  },
});

define({
  key: 'bearish_engulfing',
  name: 'Bearish engulfing candle',
  class: 'deterministic',
  params: [],
  minBars: 5,
  evaluate(candles) {
    const n = candles.length;
    const prev = candles[n - 2];
    const cur = candles[n - 1];
    const prevBullish = prev.close > prev.open;
    const curBearish = cur.close < cur.open;
    if (prevBullish && curBearish && cur.open >= prev.close && cur.close <= prev.open) {
      return { direction: 'bearish', message: 'Bearish engulfing candle formed.', values: {} };
    }
    return null;
  },
});

// ================================================================ stochastic

define({
  key: 'stochastic_cross',
  name: 'Stochastic %K / %D cross',
  class: 'stochastic',
  params: [],
  minBars: 30,
  evaluate(candles) {
    const { k, d } = momentum.stochastic(candles, 14, 3, 3);
    if (seriesCrossesAbove(k, d)) return { direction: 'bullish', message: `Stochastic %K crossed above %D (${fmt(last(k))}).`, values: { k: last(k), d: last(d) } };
    if (seriesCrossesBelow(k, d)) return { direction: 'bearish', message: `Stochastic %K crossed below %D (${fmt(last(k))}).`, values: { k: last(k), d: last(d) } };
    return null;
  },
});

define({
  key: 'stochastic_overbought_oversold',
  name: 'Stochastic overbought / oversold',
  class: 'stochastic',
  params: [{ name: 'overbought', type: 'number', default: 80 }, { name: 'oversold', type: 'number', default: 20 }],
  minBars: 30,
  evaluate(candles, { overbought = 80, oversold = 20 } = {}) {
    const { k } = momentum.stochastic(candles, 14, 3, 3);
    if (crossesAboveLevel(k, overbought)) return { direction: 'bearish', message: `Stochastic entered overbought (${fmt(last(k))}).`, values: { k: last(k) } };
    if (crossesBelowLevel(k, oversold)) return { direction: 'bullish', message: `Stochastic entered oversold (${fmt(last(k))}).`, values: { k: last(k) } };
    return null;
  },
});

define({
  key: 'stoch_rsi_cross',
  name: 'Stochastic RSI %K / %D cross',
  class: 'stochastic',
  params: [],
  minBars: 45,
  evaluate(candles) {
    const { k, d } = momentum.stochRsi(closes(candles));
    if (seriesCrossesAbove(k, d)) return { direction: 'bullish', message: `StochRSI %K crossed above %D (${fmt(last(k))}).`, values: { k: last(k) } };
    if (seriesCrossesBelow(k, d)) return { direction: 'bearish', message: `StochRSI %K crossed below %D (${fmt(last(k))}).`, values: { k: last(k) } };
    return null;
  },
});

define({
  key: 'williams_r_cross',
  name: 'Williams %R cross',
  class: 'stochastic',
  params: [],
  minBars: 30,
  evaluate(candles) {
    const wr = momentum.williamsR(candles, 14);
    if (crossesAboveLevel(wr, -20)) return { direction: 'bearish', message: `Williams %R entered overbought (${fmt(last(wr))}).`, values: { williamsR: last(wr) } };
    if (crossesBelowLevel(wr, -80)) return { direction: 'bullish', message: `Williams %R entered oversold (${fmt(last(wr))}).`, values: { williamsR: last(wr) } };
    return null;
  },
});

define({
  key: 'zscore_extreme',
  name: 'Z-score mean-reversion extreme',
  class: 'stochastic',
  params: [{ name: 'period', type: 'number', default: 20 }, { name: 'threshold', type: 'number', default: 2 }],
  minBars: 30,
  evaluate(candles, { period = 20, threshold = 2 } = {}) {
    const z = stats.zScoreSeries(closes(candles), period);
    if (crossesAboveLevel(z, threshold)) return { direction: 'bearish', message: `Price z-score crossed above +${threshold} (${fmt(last(z))}) -- stretched to the upside.`, values: { zScore: last(z) } };
    if (crossesBelowLevel(z, -threshold)) return { direction: 'bullish', message: `Price z-score crossed below -${threshold} (${fmt(last(z))}) -- stretched to the downside.`, values: { zScore: last(z) } };
    return null;
  },
});

define({
  key: 'mean_reversion_regime',
  name: 'Mean-reversion regime (OU half-life)',
  class: 'stochastic',
  params: [{ name: 'lookback', type: 'number', default: 120 }, { name: 'zThreshold', type: 'number', default: 1.5 }, { name: 'maxHalfLife', type: 'number', default: 15 }],
  minBars: 130,
  evaluate(candles, { lookback = 120, zThreshold = 1.5, maxHalfLife = 15 } = {}) {
    const c = closes(candles);
    const window = c.slice(-lookback);
    const halfLife = stats.halfLifeOU(window);
    if (halfLife === null || halfLife > maxHalfLife) return null;
    const z = stats.zScoreSeries(c, 20);
    const zVal = last(z);
    if (zVal === null) return null;
    if (Math.abs(zVal) < zThreshold) return null;
    const zPrev = last(z, 1);
    if (zPrev !== null && Math.abs(zPrev) >= zThreshold) return null; // only fire on entry into the extreme
    return {
      direction: zVal > 0 ? 'bearish' : 'bullish',
      message: `Short half-life (${fmt(halfLife, 1)}d) mean-reversion setup: z-score ${fmt(zVal)}.`,
      values: { halfLifeOU: halfLife, zScore: zVal },
    };
  },
});

define({
  key: 'hurst_regime_shift',
  name: 'Hurst exponent regime shift',
  class: 'stochastic',
  params: [{ name: 'lookback', type: 'number', default: 150 }],
  minBars: 200,
  evaluate(candles, { lookback = 150 } = {}) {
    const c = closes(candles);
    const hNow = stats.hurstExponent(c.slice(-lookback));
    const hPrev = stats.hurstExponent(c.slice(-lookback - 5, -5));
    if (hNow === null || hPrev === null) return null;
    if (hPrev < 0.5 && hNow >= 0.5) return { direction: 'bullish', message: `Hurst exponent crossed above 0.5 (${fmt(hNow, 2)}) -- regime shifting from mean-reverting to trending.`, values: { hurst: hNow } };
    if (hPrev >= 0.5 && hNow < 0.5) return { direction: 'bearish', message: `Hurst exponent crossed below 0.5 (${fmt(hNow, 2)}) -- regime shifting from trending to mean-reverting.`, values: { hurst: hNow } };
    return null;
  },
});

define({
  key: 'volatility_regime_expansion',
  name: 'Volatility regime expansion',
  class: 'stochastic',
  params: [{ name: 'multiple', type: 'number', default: 1.5 }],
  minBars: 90,
  evaluate(candles, { multiple = 1.5 } = {}) {
    const c = closes(candles);
    const vol20 = volatility.realizedVol(c, 20, 252);
    const window = vol20.slice(-60).filter(valid);
    if (window.length < 30) return null;
    const median = [...window].sort((a, b) => a - b)[Math.floor(window.length / 2)];
    const cur = last(vol20);
    const prev = last(vol20, 1);
    if (cur === null || prev === null || median === 0) return null;
    if (prev < median * multiple && cur >= median * multiple) {
      return { direction: 'neutral', message: `Realized volatility expanded to ${fmt(cur * 100, 1)}% (${fmt(multiple, 1)}× its 60-bar median).`, values: { realizedVol: cur, median } };
    }
    return null;
  },
});

define({
  key: 'atr_spike',
  name: 'ATR spike',
  class: 'stochastic',
  params: [{ name: 'multiple', type: 'number', default: 2 }],
  minBars: 60,
  evaluate(candles, { multiple = 2 } = {}) {
    const atrArr = volatility.atr(candles, 14);
    const window = atrArr.slice(-40).filter(valid);
    if (window.length < 20) return null;
    const sorted = [...window].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const cur = last(atrArr);
    if (cur !== null && median > 0 && cur >= median * multiple) {
      return { direction: 'neutral', message: `ATR spiked to ${fmt(cur, 3)} (${fmt(multiple, 1)}× its median).`, values: { atr: cur, median } };
    }
    return null;
  },
});

define({
  key: 'adf_stationarity_flip',
  name: 'ADF stationarity flip',
  class: 'stochastic',
  params: [{ name: 'lookback', type: 'number', default: 100 }],
  minBars: 130,
  evaluate(candles, { lookback = 100 } = {}) {
    const c = closes(candles);
    const now = stats.adfStatistic(c.slice(-lookback));
    const prev = stats.adfStatistic(c.slice(-lookback - 5, -5));
    if (!now || !prev) return null;
    if (!prev.stationary && now.stationary) return { direction: 'neutral', message: `ADF statistic (${fmt(now.statistic, 2)}) now indicates a stationary, mean-reverting regime.`, values: { adf: now.statistic } };
    if (prev.stationary && !now.stationary) return { direction: 'neutral', message: `ADF statistic (${fmt(now.statistic, 2)}) no longer indicates stationarity.`, values: { adf: now.statistic } };
    return null;
  },
});

define({
  key: 'kalman_trend_flip',
  name: 'Kalman filter trend flip',
  class: 'stochastic',
  params: [{ name: 'processNoise', type: 'number', default: 1e-5 }, { name: 'measurementNoise', type: 'number', default: 1e-2 }],
  minBars: 40,
  evaluate(candles, { processNoise = 1e-5, measurementNoise = 1e-2 } = {}) {
    const c = closes(candles);
    const slopes = kalmanSlope(c, processNoise, measurementNoise);
    if (flippedTo(slopes.map((s) => (s === null ? null : Math.sign(s))), 1)) {
      return { direction: 'bullish', message: 'Kalman-filtered trend slope turned positive.', values: { slope: last(slopes) } };
    }
    if (flippedTo(slopes.map((s) => (s === null ? null : Math.sign(s))), -1)) {
      return { direction: 'bearish', message: 'Kalman-filtered trend slope turned negative.', values: { slope: last(slopes) } };
    }
    return null;
  },
});

// Minimal 2-state (level, trend) Kalman filter -- returns the trend/slope
// component's estimate at each step.
function kalmanSlope(values, q = 1e-5, r = 1e-2) {
  const n = values.length;
  const slopes = new Array(n).fill(null);
  if (n < 2) return slopes;

  let level = values[0];
  let trend = values[1] - values[0];
  let P = [[1, 0], [0, 1]];
  const Q = [[q, 0], [0, q]];
  const R = r;

  for (let i = 1; i < n; i++) {
    // predict
    const levelPred = level + trend;
    const trendPred = trend;
    const P00 = P[0][0] + P[0][1] + P[1][0] + P[1][1] + Q[0][0];
    const P01 = P[0][1] + P[1][1] + Q[0][1];
    const P10 = P[1][0] + P[1][1] + Q[1][0];
    const P11 = P[1][1] + Q[1][1];

    // update (measurement = values[i], H = [1, 0])
    const y = values[i] - levelPred;
    const S = P00 + R;
    const K0 = P00 / S;
    const K1 = P10 / S;

    level = levelPred + K0 * y;
    trend = trendPred + K1 * y;

    P = [
      [P00 - K0 * P00, P01 - K0 * P01],
      [P10 - K1 * P00, P11 - K1 * P01],
    ];

    slopes[i] = trend;
  }
  return slopes;
}

define({
  key: 'monte_carlo_touch_probability',
  name: 'Monte Carlo touch probability',
  class: 'stochastic',
  params: [
    { name: 'levelPct', type: 'number', default: 5, min: 0.5, max: 50 },
    { name: 'direction', type: 'enum', options: ['up', 'down'], default: 'up' },
    { name: 'horizonBars', type: 'number', default: 10, min: 1, max: 60 },
    { name: 'threshold', type: 'number', default: 0.5, min: 0.05, max: 0.95 },
  ],
  minBars: 80,
  evaluate(candles, { levelPct = 5, direction = 'up', horizonBars = 10, threshold = 0.5 } = {}) {
    const c = closes(candles);
    const prob = monteCarloTouchProbability(c, levelPct, direction, horizonBars);
    const probPrev = monteCarloTouchProbability(c.slice(0, -1), levelPct, direction, horizonBars);
    if (prob === null || probPrev === null) return null;
    if (probPrev < threshold && prob >= threshold) {
      return {
        direction: direction === 'up' ? 'bullish' : 'bearish',
        message: `Simulated P(touch ${direction} ${levelPct}% within ${horizonBars} bars) crossed above ${fmt(threshold * 100, 0)}% (now ${fmt(prob * 100, 0)}%).`,
        values: { probability: prob },
      };
    }
    return null;
  },
});

// Calibrates a GBM to recent daily drift/vol and Monte Carlo-simulates the
// probability that price touches `level%` away within `horizonBars`.
// 500 paths is enough for a stable estimate at this granularity without
// being expensive to run on every bar close for an opted-in alert rule.
function monteCarloTouchProbability(closesArr, levelPct, direction, horizonBars, paths = 500) {
  const n = closesArr.length;
  if (n < 40) return null;
  const window = closesArr.slice(-60);
  const rets = [];
  for (let i = 1; i < window.length; i++) rets.push(Math.log(window[i] / window[i - 1]));
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1);
  const sigma = Math.sqrt(Math.max(0, variance));

  const s0 = closesArr[n - 1];
  const target = direction === 'up' ? s0 * (1 + levelPct / 100) : s0 * (1 - levelPct / 100);
  let touches = 0;

  for (let p = 0; p < paths; p++) {
    let s = s0;
    let touched = false;
    for (let t = 0; t < horizonBars; t++) {
      const z = gaussianRandom();
      s = s * Math.exp(mu - 0.5 * sigma * sigma + sigma * z);
      if ((direction === 'up' && s >= target) || (direction === 'down' && s <= target)) {
        touched = true;
        break;
      }
    }
    if (touched) touches++;
  }
  return touches / paths;
}

function gaussianRandom() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

define({
  key: 'correlation_breakdown',
  name: 'Correlation breakdown vs SPY',
  class: 'stochastic',
  params: [{ name: 'period', type: 'number', default: 60 }, { name: 'threshold', type: 'number', default: 0.3 }],
  minBars: 70,
  requiresBenchmark: true,
  evaluate(candles, { period = 60, threshold = 0.3 } = {}, { benchmarkCandles } = {}) {
    if (!benchmarkCandles || benchmarkCandles.length < period + 5) return null;
    const c = closes(candles);
    const b = closes(benchmarkCandles);
    const n = Math.min(c.length, b.length);
    const corrNow = stats.correlation(c.slice(n - period, n), b.slice(n - period, n));
    const corrPrev = stats.correlation(c.slice(n - period - 1, n - 1), b.slice(n - period - 1, n - 1));
    if (corrNow === null || corrPrev === null) return null;
    if (corrPrev >= threshold && corrNow < threshold) {
      return { direction: 'neutral', message: `${period}-bar correlation with SPY dropped below ${threshold} (now ${fmt(corrNow, 2)}).`, values: { correlation: corrNow } };
    }
    return null;
  },
});

function getSignal(key) {
  return SIGNALS.find((s) => s.key === key);
}

function listSignals() {
  return SIGNALS.map(({ key, name, class: cls, params, requiresBenchmark }) => ({ key, name, class: cls, params, requiresBenchmark: !!requiresBenchmark }));
}

module.exports = { SIGNALS, getSignal, listSignals };
