import { bus } from '../bus.js';
import { registerWidget } from '../registry.js';

function pct(x, decimals = 2) {
  return x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(decimals)}%`;
}
function num(x, decimals = 2) {
  return x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(decimals);
}
function bigNum(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (Math.abs(x) >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (Math.abs(x) >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return x.toFixed(0);
}
function signClass(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '';
  return x > 0 ? 'up' : x < 0 ? 'down' : '';
}

const TILE_GROUPS = [
  {
    label: 'Price & returns',
    tiles: [
      ['Last', (m) => num(m.price.last), () => ''],
      ['Day change', (m) => pct(m.price.dayChangePct), (m) => signClass(m.price.dayChangePct)],
      ['1W', (m) => pct(m.price.ret1w), (m) => signClass(m.price.ret1w)],
      ['1M', (m) => pct(m.price.ret1m), (m) => signClass(m.price.ret1m)],
      ['3M', (m) => pct(m.price.ret3m), (m) => signClass(m.price.ret3m)],
      ['YTD', (m) => pct(m.price.retYtd), (m) => signClass(m.price.retYtd)],
      ['1Y', (m) => pct(m.price.ret1y), (m) => signClass(m.price.ret1y)],
      ['CAGR', (m) => pct(m.price.cagr), (m) => signClass(m.price.cagr)],
    ],
  },
  {
    label: 'Volatility & risk',
    tiles: [
      ['Realized vol (20d)', (m) => pct(m.risk.realizedVol20d, 1), () => ''],
      ['Realized vol (60d)', (m) => pct(m.risk.realizedVol60d, 1), () => ''],
      ['ATR %', (m) => pct(m.risk.atrPct14 !== null ? m.risk.atrPct14 / 100 : null, 2), () => ''],
      ['Max drawdown', (m) => pct(m.risk.maxDrawdown), () => 'down'],
      ['Current drawdown', (m) => pct(m.risk.currentDrawdown), () => 'down'],
      ['VaR 95%', (m) => pct(m.risk.historicalVaR95), () => 'down'],
      ['Beta vs SPY', (m) => num(m.risk.betaVsSpy), () => ''],
      ['Corr vs SPY', (m) => num(m.risk.correlationVsSpy), () => ''],
    ],
  },
  {
    label: 'Risk-adjusted',
    tiles: [
      ['Sharpe', (m) => num(m.riskAdjusted.sharpe), (m) => signClass(m.riskAdjusted.sharpe)],
      ['Sortino', (m) => num(m.riskAdjusted.sortino), (m) => signClass(m.riskAdjusted.sortino)],
      ['Calmar', (m) => num(m.riskAdjusted.calmar), (m) => signClass(m.riskAdjusted.calmar)],
    ],
  },
  {
    label: 'Trend & momentum',
    tiles: [
      ['RSI (14)', (m) => num(m.trend.rsi14, 1), () => ''],
      ['Stoch %K/%D', (m) => `${num(m.trend.stochK, 0)}/${num(m.trend.stochD, 0)}`, () => ''],
      ['MACD hist', (m) => num(m.trend.macdHistogram, 3), (m) => signClass(m.trend.macdHistogram)],
      ['ADX (14)', (m) => num(m.trend.adx14, 1), () => ''],
      ['vs 50d SMA', (m) => pct(m.trend.pctVsSma50), (m) => signClass(m.trend.pctVsSma50)],
      ['vs 200d SMA', (m) => pct(m.trend.pctVsSma200), (m) => signClass(m.trend.pctVsSma200)],
      ['From 52w high', (m) => pct(m.trend.pctFrom52wHigh), () => 'down'],
      ['From 52w low', (m) => pct(m.trend.pctFrom52wLow), () => 'up'],
    ],
  },
  {
    label: 'Volume & liquidity',
    tiles: [
      ['Avg volume (20d)', (m) => bigNum(m.liquidity.avgVolume20d), () => ''],
      ['Relative volume', (m) => `${num(m.liquidity.relativeVolume, 2)}×`, () => ''],
      ['Dollar volume', (m) => bigNum(m.liquidity.dollarVolume), () => ''],
      ['VWAP deviation', (m) => pct(m.liquidity.vwapDeviationPct), (m) => signClass(m.liquidity.vwapDeviationPct)],
    ],
  },
  {
    label: 'Statistical',
    tiles: [
      ['Z-score (20d)', (m) => num(m.statistical.zScore20d), () => ''],
      ['Z-score (60d)', (m) => num(m.statistical.zScore60d), () => ''],
      ['Skewness', (m) => num(m.statistical.skewness), () => ''],
      ['Kurtosis', (m) => num(m.statistical.kurtosis), () => ''],
      ['Hurst exponent', (m) => num(m.statistical.hurstExponent), () => ''],
      ['Mean-reversion half-life', (m) => (m.statistical.halfLifeOU !== null ? `${num(m.statistical.halfLifeOU, 1)}d` : '—'), () => ''],
      ['Autocorr (lag 1)', (m) => num(m.statistical.autocorrelationLag1), () => ''],
    ],
  },
];

function mount(el) {
  const wrap = document.createElement('div');
  wrap.className = 'metrics-widget';
  el.appendChild(wrap);

  let currentSymbolKey = null;

  async function load({ background = false } = {}) {
    const instrument = bus.activeInstrument;
    if (!instrument) {
      currentSymbolKey = null;
      wrap.innerHTML = '<p class="widget-empty">Pick a symbol to see metrics.</p>';
      return;
    }
    const key = `${instrument.symbol}:${instrument.asset_class}`;
    const isNewKey = key !== currentSymbolKey;
    currentSymbolKey = key;
    if (!background || isNewKey) wrap.innerHTML = '<p class="widget-empty">Loading…</p>';
    try {
      const data = await bus.request(`/api/metrics?symbol=${encodeURIComponent(instrument.symbol)}&assetClass=${instrument.asset_class}`);
      if (currentSymbolKey !== key) return;
      render(data.metrics);
    } catch (err) {
      if (currentSymbolKey !== key) return;
      if (background && !isNewKey) return; // don't blow away good tiles over a transient background poll failure
      if (err.code === 'NO_KEY') {
        wrap.innerHTML = `<p class="widget-empty">Connect a <strong>${err.data.provider}</strong> API key in <a href="/settings">Settings</a>.</p>`;
      } else {
        wrap.innerHTML = `<p class="widget-empty">${err.message || 'Failed to load metrics.'}</p>`;
      }
    }
  }

  function render(metrics) {
    if (!metrics.available) {
      wrap.innerHTML = `<p class="widget-empty">${metrics.reason}</p>`;
      return;
    }
    wrap.innerHTML = '';

    const asOfDate = new Date(metrics.asOf);
    const staleDays = (Date.now() - asOfDate.getTime()) / 86400000;
    const asOf = document.createElement('div');
    asOf.className = `metrics-asof${staleDays > 3 ? ' stale' : ''}`;
    asOf.textContent = `As of ${asOfDate.toLocaleDateString()}${staleDays > 3 ? ' -- data may be stale' : ''}`;
    wrap.appendChild(asOf);

    for (const group of TILE_GROUPS) {
      const section = document.createElement('div');
      section.className = 'metrics-group';
      const heading = document.createElement('div');
      heading.className = 'metrics-group-label';
      heading.textContent = group.label;
      section.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'metrics-tile-grid';
      for (const [label, valueFn, classFn] of group.tiles) {
        const tile = document.createElement('div');
        tile.className = 'metric-tile';
        const valueEl = document.createElement('div');
        valueEl.className = `metric-tile-value ${classFn(metrics)}`;
        valueEl.textContent = valueFn(metrics);
        const labelEl = document.createElement('div');
        labelEl.className = 'metric-tile-label';
        labelEl.textContent = label;
        tile.appendChild(valueEl);
        tile.appendChild(labelEl);
        grid.appendChild(tile);
      }
      section.appendChild(grid);
      wrap.appendChild(section);
    }
  }

  const offSymbol = bus.on('symbol:changed', () => load());
  load();
  const pollTimer = setInterval(() => load({ background: true }), 60000);

  return { unmount() { offSymbol(); clearInterval(pollTimer); } };
}

registerWidget({ id: 'metrics', title: 'Metrics', defaultSize: { w: 6, h: 4 }, mount });
