const { closes, highs, lows, volumes, typicalPrices, medianPrices, mean, rollingApply, trueRange } = require('./utils');
const { sma, ema } = require('./overlap');

// Wilder's RSI: seeded with a plain average of the first `period` gains and
// losses, then smoothed -- same seeding convention as ATR.
function rsi(values, period = 14) {
  const n = values.length;
  const out = new Array(n).fill(null);
  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = values[i] - values[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }

  let avgGain = null;
  let avgLoss = null;
  for (let i = period; i < n; i++) {
    if (avgGain === null) {
      avgGain = mean(gains.slice(1, period + 1));
      avgLoss = mean(losses.slice(1, period + 1));
    } else {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    if (avgGain === 0 && avgLoss === 0) {
      // No movement at all in the window -- neutral, not "maximally
      // overbought" (avgLoss === 0 alone isn't sufficient: that's also
      // true of a flat market with zero gains, which should read 50).
      out[i] = 50;
    } else if (avgLoss === 0) {
      out[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

function stochastic(candles, kPeriod = 14, kSmooth = 3, dPeriod = 3) {
  const h = highs(candles);
  const l = lows(candles);
  const c = closes(candles);
  const n = candles.length;
  const rawK = new Array(n).fill(null);

  for (let i = kPeriod - 1; i < n; i++) {
    const hh = Math.max(...h.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...l.slice(i - kPeriod + 1, i + 1));
    rawK[i] = hh === ll ? 50 : ((c[i] - ll) / (hh - ll)) * 100;
  }

  const k = kSmooth > 1 ? sma(rawK, kSmooth) : rawK;
  const d = sma(k, dPeriod);
  return { k, d };
}

function stochRsi(values, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const rsiVals = rsi(values, rsiPeriod);
  const n = values.length;
  const rawStoch = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (rsiVals[i] === null) continue;
    const windowStart = Math.max(0, i - stochPeriod + 1);
    const window = rsiVals.slice(windowStart, i + 1).filter((v) => v !== null);
    if (window.length < stochPeriod) continue;
    const hh = Math.max(...window);
    const ll = Math.min(...window);
    rawStoch[i] = hh === ll ? 50 : ((rsiVals[i] - ll) / (hh - ll)) * 100;
  }

  const k = sma(rawStoch, kSmooth);
  const d = sma(k, dSmooth);
  return { k, d, raw: rawStoch };
}

function williamsR(candles, period = 14) {
  const h = highs(candles);
  const l = lows(candles);
  const c = closes(candles);
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const hh = Math.max(...h.slice(i - period + 1, i + 1));
    const ll = Math.min(...l.slice(i - period + 1, i + 1));
    out[i] = hh === ll ? -50 : ((hh - c[i]) / (hh - ll)) * -100;
  }
  return out;
}

function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const macdLine = values.map((_, i) => (fast[i] !== null && slow[i] !== null ? fast[i] - slow[i] : null));
  const signal = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => (v !== null && signal[i] !== null ? v - signal[i] : null));
  return { macd: macdLine, signal, histogram };
}

function cci(candles, period = 20) {
  const tp = typicalPrices(candles);
  const smaTp = sma(tp, period);
  return rollingApply(tp, period, (window, idx) => {
    const i = idx;
    const md = mean(window.map((v) => Math.abs(v - smaTp[i])));
    return md === 0 ? 0 : (tp[i] - smaTp[i]) / (0.015 * md);
  });
}

function roc(values, period = 12) {
  const out = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i - period] === 0 ? null : ((values[i] - values[i - period]) / values[i - period]) * 100;
  }
  return out;
}

// Wilder's ADX / +DI / -DI.
function adx(candles, period = 14) {
  const n = candles.length;
  const h = highs(candles);
  const l = lows(candles);
  const tr = trueRange(candles);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = h[i] - h[i - 1];
    const downMove = l[i - 1] - l[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const dx = new Array(n).fill(null);
  const adxOut = new Array(n).fill(null);

  let smoothTR = null;
  let smoothPlusDM = null;
  let smoothMinusDM = null;
  let adxPrev = null;
  const dxHistory = [];

  for (let i = 1; i < n; i++) {
    if (smoothTR === null) {
      if (i >= period) {
        smoothTR = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
        smoothPlusDM = plusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
        smoothMinusDM = minusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
      } else {
        continue;
      }
    } else {
      smoothTR = smoothTR - smoothTR / period + tr[i];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    }

    plusDI[i] = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100;
    minusDI[i] = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100;
    const diSum = plusDI[i] + minusDI[i];
    dx[i] = diSum === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / diSum) * 100;
    dxHistory.push(dx[i]);

    if (dxHistory.length === period) {
      adxPrev = mean(dxHistory);
      adxOut[i] = adxPrev;
    } else if (dxHistory.length > period) {
      adxPrev = (adxPrev * (period - 1) + dx[i]) / period;
      adxOut[i] = adxPrev;
    }
  }

  return { adx: adxOut, plusDI, minusDI };
}

function aroon(candles, period = 25) {
  const h = highs(candles);
  const l = lows(candles);
  const n = candles.length;
  const up = new Array(n).fill(null);
  const down = new Array(n).fill(null);

  for (let i = period; i < n; i++) {
    const windowH = h.slice(i - period, i + 1);
    const windowL = l.slice(i - period, i + 1);
    // hIdx/lIdx are the position of the extreme within the (period+1)-bar
    // window; periods-since-extreme = period - hIdx, so Aroon = (hIdx/period)*100.
    const hIdx = windowH.lastIndexOf(Math.max(...windowH));
    const lIdx = windowL.lastIndexOf(Math.min(...windowL));
    up[i] = (hIdx / period) * 100;
    down[i] = (lIdx / period) * 100;
  }
  return { up, down };
}

function awesomeOscillator(candles, fastPeriod = 5, slowPeriod = 34) {
  const mp = medianPrices(candles);
  const fast = sma(mp, fastPeriod);
  const slow = sma(mp, slowPeriod);
  return fast.map((v, i) => (v !== null && slow[i] !== null ? v - slow[i] : null));
}

function mfi(candles, period = 14) {
  const tp = typicalPrices(candles);
  const vol = volumes(candles);
  const n = candles.length;
  const rawFlow = tp.map((v, i) => v * vol[i]);
  const out = new Array(n).fill(null);

  for (let i = period; i < n; i++) {
    let positive = 0;
    let negative = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) positive += rawFlow[j];
      else if (tp[j] < tp[j - 1]) negative += rawFlow[j];
    }
    if (negative === 0) {
      out[i] = 100;
    } else {
      const ratio = positive / negative;
      out[i] = 100 - 100 / (1 + ratio);
    }
  }
  return out;
}

module.exports = { rsi, stochastic, stochRsi, williamsR, macd, cci, roc, adx, aroon, awesomeOscillator, mfi };
