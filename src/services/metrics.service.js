// Assembles the metrics-grid payload for a symbol from cached daily OHLCV
// -- every figure here is computed locally; the provider only ever supplies
// candles (PLAN.md §5). Always computed on the '1D' timeframe regardless of
// the chart's active timeframe, since most of these (Sharpe, drawdown, 52w
// high/low, ...) are conventionally daily-basis figures.
const candlesRepo = require('../db/repositories/candles.repo');
const { closes, highs, lows, volumes, logReturns, pctReturns, lastValid } = require('./indicators/utils');
const overlap = require('./indicators/overlap');
const momentum = require('./indicators/momentum');
const volatility = require('./indicators/volatility');
const volume = require('./indicators/volume');
const stats = require('./indicators/stats');

const TRADING_DAYS_PER_YEAR = 252;

function pctChange(from, to) {
  if (from === undefined || from === null || from === 0) return null;
  return (to - from) / from;
}

function returnOverLookback(closeArr, lookback) {
  const n = closeArr.length;
  if (n <= lookback) return null;
  return pctChange(closeArr[n - 1 - lookback], closeArr[n - 1]);
}

function ytdReturn(candles) {
  const lastYear = candles[candles.length - 1].ts.getUTCFullYear();
  const firstOfYearIdx = candles.findIndex((c) => c.ts.getUTCFullYear() === lastYear);
  if (firstOfYearIdx === -1) return null;
  return pctChange(candles[firstOfYearIdx].close, candles[candles.length - 1].close);
}

async function computeMetrics(instrument, { benchmarkCandles } = {}) {
  const candles = await candlesRepo.getLatest(instrument.id, '1D', 400);
  if (candles.length < 20) {
    return { available: false, reason: 'Not enough history yet -- keep the dashboard open for a bit to build up the cache.' };
  }

  const closeArr = closes(candles);
  const highArr = highs(candles);
  const lowArr = lows(candles);
  const last = closeArr[closeArr.length - 1];
  const prev = closeArr[closeArr.length - 2];

  const logRets = logReturns(closeArr).filter((v) => v !== null);
  const pctRets = pctReturns(closeArr).filter((v) => v !== null);

  // -- price & returns ------------------------------------------------------
  const price = {
    last,
    dayChangePct: pctChange(prev, last),
    ret1w: returnOverLookback(closeArr, 5),
    ret1m: returnOverLookback(closeArr, 21),
    ret3m: returnOverLookback(closeArr, 63),
    ret6m: returnOverLookback(closeArr, 126),
    retYtd: ytdReturn(candles),
    ret1y: returnOverLookback(closeArr, 252),
    cagr: stats.cagr(closeArr, TRADING_DAYS_PER_YEAR),
    gapPct: candles.length > 1 ? pctChange(candles[candles.length - 2].close, candles[candles.length - 1].open) : null,
  };

  // -- volatility & risk ------------------------------------------------------
  const atrArr = volatility.atr(candles, 14);
  const atrPctArr = volatility.atrPercent(candles, 14);
  const dd = stats.maxDrawdown(closeArr);
  const risk = {
    realizedVol20d: lastValid(volatility.realizedVol(closeArr, 20, TRADING_DAYS_PER_YEAR)),
    realizedVol60d: lastValid(volatility.realizedVol(closeArr, 60, TRADING_DAYS_PER_YEAR)),
    parkinsonVol20d: lastValid(volatility.parkinsonVol(candles, 20, TRADING_DAYS_PER_YEAR)),
    garmanKlassVol20d: lastValid(volatility.garmanKlassVol(candles, 20, TRADING_DAYS_PER_YEAR)),
    atr14: lastValid(atrArr),
    atrPct14: lastValid(atrPctArr),
    maxDrawdown: dd.maxDrawdown,
    currentDrawdown: dd.currentDrawdown,
    downsideDeviation: (() => {
      const negative = pctRets.filter((r) => r < 0);
      if (negative.length === 0) return null;
      const m = negative.reduce((a, b) => a + b, 0) / negative.length;
      return Math.sqrt(negative.reduce((a, b) => a + (b - m) ** 2, 0) / negative.length);
    })(),
    historicalVaR95: stats.historicalVaR(pctRets, 0.95),
  };

  if (benchmarkCandles && benchmarkCandles.length > 20) {
    const benchCloses = closes(benchmarkCandles);
    const benchRets = logReturns(benchCloses).filter((v) => v !== null);
    const n = Math.min(logRets.length, benchRets.length);
    risk.betaVsSpy = stats.beta(logRets.slice(-n), benchRets.slice(-n));
    risk.correlationVsSpy = stats.correlation(logRets.slice(-n), benchRets.slice(-n));
  } else {
    risk.betaVsSpy = null;
    risk.correlationVsSpy = null;
  }

  // -- risk-adjusted ------------------------------------------------------
  const riskAdjusted = {
    sharpe: stats.sharpeRatio(pctRets, 0, TRADING_DAYS_PER_YEAR),
    sortino: stats.sortinoRatio(pctRets, 0, TRADING_DAYS_PER_YEAR),
    calmar: stats.calmarRatio(price.cagr, dd.maxDrawdown),
  };

  // -- trend & momentum snapshot ------------------------------------------------------
  const sma50 = lastValid(overlap.sma(closeArr, 50));
  const sma200 = lastValid(overlap.sma(closeArr, 200));
  const sma200Series = overlap.sma(closeArr, 200);
  const sma200Prev = sma200Series.length > 10 ? sma200Series[sma200Series.length - 11] : null;
  const high52w = Math.max(...highArr.slice(-252));
  const low52w = Math.min(...lowArr.slice(-252));
  const macdOut = momentum.macd(closeArr);

  const trend = {
    rsi14: lastValid(momentum.rsi(closeArr, 14)),
    stochK: lastValid(momentum.stochastic(candles, 14, 3, 3).k),
    stochD: lastValid(momentum.stochastic(candles, 14, 3, 3).d),
    macdHistogram: lastValid(macdOut.histogram),
    adx14: lastValid(momentum.adx(candles, 14).adx),
    pctFrom52wHigh: pctChange(high52w, last),
    pctFrom52wLow: pctChange(low52w, last),
    pctVsSma50: sma50 ? pctChange(sma50, last) : null,
    pctVsSma200: sma200 ? pctChange(sma200, last) : null,
    sma200SlopePct: sma200 !== null && sma200Prev ? pctChange(sma200Prev, sma200) : null,
  };

  // -- volume & liquidity ------------------------------------------------------
  const volArr = volumes(candles);
  const avgVol20 = volArr.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volArr.length);
  const vwapArr = overlap.vwap(candles.slice(-20));
  const liquidity = {
    avgVolume20d: avgVol20,
    relativeVolume: lastValid(volume.relativeVolume(candles, 20)),
    dollarVolume: last * volArr[volArr.length - 1],
    vwapDeviationPct: pctChange(lastValid(vwapArr), last),
  };

  // -- statistical ------------------------------------------------------
  const statistical = {
    zScore20d: lastValid(stats.zScoreSeries(closeArr, 20)),
    zScore60d: lastValid(stats.zScoreSeries(closeArr, 60)),
    skewness: stats.skewness(pctRets.slice(-120)),
    kurtosis: stats.kurtosis(pctRets.slice(-120)),
    hurstExponent: stats.hurstExponent(closeArr),
    halfLifeOU: stats.halfLifeOU(closeArr.slice(-120)),
    autocorrelationLag1: (() => {
      const n = pctRets.length;
      if (n < 10) return null;
      return stats.correlation(pctRets.slice(0, n - 1), pctRets.slice(1));
    })(),
  };

  return {
    available: true,
    asOf: candles[candles.length - 1].ts,
    price,
    risk,
    riskAdjusted,
    trend,
    liquidity,
    statistical,
  };
}

module.exports = { computeMetrics };
