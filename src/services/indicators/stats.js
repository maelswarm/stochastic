const { mean, stddev, logReturns, dropNulls, EPSILON } = require('./utils');

function zScoreSeries(values, period = 20) {
  const n = values.length;
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const sd = stddev(window, 1);
    out[i] = sd < EPSILON ? 0 : (values[i] - mean(window)) / sd;
  }
  return out;
}

function skewness(values) {
  const n = values.length;
  if (n < 3) return null;
  const m = mean(values);
  const sd = stddev(values, 1);
  if (sd < EPSILON) return 0;
  const m3 = values.reduce((a, b) => a + (b - m) ** 3, 0) / n;
  return (m3 / sd ** 3) * (Math.sqrt(n * (n - 1)) / (n - 2));
}

// Excess kurtosis (0 = normal distribution).
function kurtosis(values) {
  const n = values.length;
  if (n < 4) return null;
  const m = mean(values);
  const sd = stddev(values, 1);
  if (sd < EPSILON) return 0;
  const m4 = values.reduce((a, b) => a + (b - m) ** 4, 0) / n;
  return m4 / sd ** 4 - 3;
}

// Rescaled-range (R/S) Hurst exponent: splits the series into
// progressively smaller chunks, averages R/S per chunk size, then takes the
// slope of log(R/S) vs log(chunk size). ~0.5 = random walk, >0.5 = trending
// / persistent, <0.5 = mean-reverting. A simplified but standard estimator
// -- not a substitute for a rigorous DFA implementation.
function hurstExponent(values) {
  const rets = dropNulls(logReturns(values));
  const n = rets.length;
  if (n < 40) return null;

  const chunkSizes = [8, 16, 32, 64, 128].filter((s) => s <= n / 2);
  if (chunkSizes.length < 3) return null;

  const points = [];
  for (const size of chunkSizes) {
    const rsValues = [];
    for (let start = 0; start + size <= n; start += size) {
      const chunk = rets.slice(start, start + size);
      const m = mean(chunk);
      const deviations = chunk.map((v) => v - m);
      let cumulative = 0;
      let minCum = Infinity;
      let maxCum = -Infinity;
      for (const d of deviations) {
        cumulative += d;
        if (cumulative < minCum) minCum = cumulative;
        if (cumulative > maxCum) maxCum = cumulative;
      }
      const range = maxCum - minCum;
      const sd = stddev(chunk, 0);
      if (sd > 0) rsValues.push(range / sd);
    }
    if (rsValues.length > 0) points.push([Math.log(size), Math.log(mean(rsValues))]);
  }
  if (points.length < 3) return null;

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const { slope } = linearRegression(xs, ys);
  return slope;
}

function linearRegression(xs, ys) {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  return { slope, intercept };
}

// Mean-reversion half-life via an AR(1)/Ornstein-Uhlenbeck fit: regress
// delta(y) on lagged y. A negative slope (lambda) implies reversion;
// half-life = ln(2) / |lambda| periods. Returns null if the series doesn't
// show reversion (lambda >= 0).
function halfLifeOU(values) {
  const n = values.length;
  if (n < 20) return null;
  const yLag = values.slice(0, n - 1);
  const dy = [];
  for (let i = 1; i < n; i++) dy.push(values[i] - values[i - 1]);

  const { slope: lambda } = linearRegression(yLag, dy);
  if (lambda >= 0) return null;
  return Math.log(2) / -lambda;
}

// Simplified Augmented Dickey-Fuller-style statistic (no augmentation
// lags, no drift/trend terms): regress delta(y) on lagged y, then compute
// the t-statistic of that slope. More negative = stronger evidence against
// a unit root (i.e. more evidence of stationarity / mean reversion).
// -2.86 is the common ~5% critical value for the no-drift case at large n.
function adfStatistic(values) {
  const n = values.length;
  if (n < 20) return null;
  const yLag = values.slice(0, n - 1);
  const dy = [];
  for (let i = 1; i < n; i++) dy.push(values[i] - values[i - 1]);

  const { slope, intercept } = linearRegression(yLag, dy);
  const residuals = dy.map((v, i) => v - (intercept + slope * yLag[i]));
  const rss = residuals.reduce((a, b) => a + b ** 2, 0);
  const dof = dy.length - 2;
  if (dof <= 0) return null;
  const sigma2 = rss / dof;
  const mx = mean(yLag);
  const sxx = yLag.reduce((a, b) => a + (b - mx) ** 2, 0);
  if (sxx === 0) return null;
  const seSlope = Math.sqrt(sigma2 / sxx);
  const tStat = seSlope === 0 ? null : slope / seSlope;
  return tStat === null ? null : { statistic: tStat, stationary: tStat < -2.86 };
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : num / denom;
}

function beta(assetReturns, marketReturns) {
  const n = Math.min(assetReturns.length, marketReturns.length);
  if (n < 2) return null;
  const a = assetReturns.slice(-n);
  const m = marketReturns.slice(-n);
  const mm = mean(m);
  const ma = mean(a);
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (m[i] - mm);
    varM += (m[i] - mm) ** 2;
  }
  return varM === 0 ? null : cov / varM;
}

// Historical (non-parametric) Value at Risk: the loss magnitude at the
// given confidence level, expressed as a positive fraction (e.g. 0.032 =
// 3.2% loss threshold at 95% confidence).
function historicalVaR(returns, confidence = 0.95) {
  const sorted = dropNulls(returns).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const idx = Math.floor((1 - confidence) * sorted.length);
  const value = sorted[Math.min(idx, sorted.length - 1)];
  return value < 0 ? -value : 0;
}

function maxDrawdown(values) {
  let peak = values[0];
  let maxDD = 0;
  let current = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = peak === 0 ? 0 : (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const lastPeak = Math.max(...values);
  current = lastPeak === 0 ? 0 : (lastPeak - values[values.length - 1]) / lastPeak;
  return { maxDrawdown: maxDD, currentDrawdown: current };
}

function cagr(values, periodsPerYear = 252) {
  const n = values.length;
  if (n < 2 || values[0] <= 0) return null;
  const totalReturn = values[n - 1] / values[0];
  const years = (n - 1) / periodsPerYear;
  if (years <= 0) return null;
  return totalReturn ** (1 / years) - 1;
}

function sharpeRatio(returns, riskFreePerPeriod = 0, annualizationFactor = 252) {
  const rets = dropNulls(returns);
  if (rets.length < 2) return null;
  const excess = rets.map((r) => r - riskFreePerPeriod);
  const sd = stddev(excess, 1);
  return sd < EPSILON ? null : (mean(excess) / sd) * Math.sqrt(annualizationFactor);
}

function sortinoRatio(returns, riskFreePerPeriod = 0, annualizationFactor = 252) {
  const rets = dropNulls(returns);
  if (rets.length < 2) return null;
  const excess = rets.map((r) => r - riskFreePerPeriod);
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return null;
  const downsideDev = Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / excess.length);
  return downsideDev < EPSILON ? null : (mean(excess) / downsideDev) * Math.sqrt(annualizationFactor);
}

function calmarRatio(cagrValue, maxDrawdownValue) {
  if (cagrValue === null || !maxDrawdownValue) return null;
  return cagrValue / maxDrawdownValue;
}

module.exports = {
  zScoreSeries, skewness, kurtosis, hurstExponent, halfLifeOU, adfStatistic,
  correlation, beta, historicalVaR, maxDrawdown, cagr, sharpeRatio, sortinoRatio,
  calmarRatio, linearRegression,
};
