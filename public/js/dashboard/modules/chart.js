import { bus } from '../bus.js';
import { registerWidget } from '../registry.js';

function fmtCandle(c) {
  return { time: Math.floor(new Date(c.ts).getTime() / 1000), open: c.open, high: c.high, low: c.low, close: c.close };
}
function fmtVolume(c) {
  return {
    time: Math.floor(new Date(c.ts).getTime() / 1000),
    value: c.volume,
    color: c.close >= c.open ? 'rgba(38, 208, 124, 0.5)' : 'rgba(255, 92, 92, 0.5)',
  };
}

function mount(el) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-widget';
  const status = document.createElement('div');
  status.className = 'chart-status';
  status.hidden = true;
  const chartEl = document.createElement('div');
  chartEl.className = 'chart-canvas';
  wrap.appendChild(status);
  wrap.appendChild(chartEl);
  el.appendChild(wrap);

  const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const colors = theme === 'light'
    ? { bg: '#ffffff', text: '#14161a', grid: '#eceef0', border: '#dcdfe3' }
    : { bg: '#0b0d10', text: '#edeef0', grid: '#181b20', border: '#262b32' };

  const chart = window.LightweightCharts.createChart(chartEl, {
    layout: { background: { color: colors.bg }, textColor: colors.text },
    grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
    rightPriceScale: { borderColor: colors.border },
    timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
    autoSize: true,
  });

  const candleSeries = chart.addSeries(window.LightweightCharts.CandlestickSeries, {
    upColor: '#26d07c',
    downColor: '#ff5c5c',
    borderVisible: false,
    wickUpColor: '#26d07c',
    wickDownColor: '#ff5c5c',
  });

  const volumeSeries = chart.addSeries(window.LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  let currentKey = null;
  let reqToken = 0;
  let inFlight = false;
  // The chart widget only ever shows bus.activeInstrument -- i.e. whatever
  // symbol is currently displayed -- so it always polls "live" (bypassing
  // the shared cache-staleness window in favor of an always-fresh fetch,
  // paced to exactly 1/sec by budget.service). Nothing else polls this
  // aggressively; symbols that aren't on screen right now aren't touched by
  // this widget at all. Polls are chained (next scheduled only after the
  // current response lands), never overlapped -- overlapping 1s polls
  // invalidate each other's reqToken faster than responses arrive, so
  // nothing ever renders.
  const POLL_MS = 1000;

  async function load({ background = false } = {}) {
    if (background && inFlight) return; // user-initiated loads still preempt via reqToken
    const instrument = bus.activeInstrument;
    const timeframe = bus.activeTimeframe;
    if (!instrument) {
      status.hidden = false;
      status.textContent = 'Pick a symbol to load a chart.';
      return;
    }
    const key = `${instrument.symbol}:${instrument.asset_class}:${timeframe}`;
    const isNewKey = key !== currentKey;
    currentKey = key;
    const token = ++reqToken;
    if (!background || isNewKey) {
      status.hidden = false;
      status.textContent = 'Loading…';
    }

    inFlight = true;
    try {
      const data = await bus.request(
        `/api/candles?symbol=${encodeURIComponent(instrument.symbol)}&assetClass=${instrument.asset_class}&tf=${timeframe}&limit=500&live=1`
      );
      if (token !== reqToken || currentKey !== key) return;
      candleSeries.setData(data.candles.map(fmtCandle));
      volumeSeries.setData(data.candles.map(fmtVolume));
      status.hidden = data.candles.length > 0;
      status.textContent = data.candles.length === 0 ? 'No data available yet.' : '';
      // Only snap the view on an actual symbol/timeframe change -- a
      // background poll updating the same series shouldn't yank the user's
      // zoom/pan back to fit-all every 20s.
      if (isNewKey) chart.timeScale().fitContent();
    } catch (err) {
      if (token !== reqToken) return;
      if (background && !isNewKey) return; // don't blow away a good chart over a transient background poll failure
      status.hidden = false;
      if (err.code === 'NO_KEY') {
        status.innerHTML = `Connect a <strong>${err.data.provider}</strong> API key in <a href="/settings">Settings</a> to load this data.`;
      } else if (err.code === 'RATE_LIMITED') {
        status.textContent = 'Rate limited -- retrying shortly.';
        setTimeout(load, 3000);
      } else {
        status.textContent = err.message || 'Failed to load chart data.';
      }
      candleSeries.setData([]);
      volumeSeries.setData([]);
    } finally {
      inFlight = false;
    }
  }

  const offSymbol = bus.on('symbol:changed', () => load());
  const offTf = bus.on('timeframe:changed', () => load());
  load();

  let pollTimer = null;
  let unmounted = false;
  function scheduleNextPoll() {
    if (unmounted) return;
    pollTimer = setTimeout(async () => {
      try {
        await load({ background: true });
      } finally {
        scheduleNextPoll();
      }
    }, POLL_MS);
  }
  scheduleNextPoll();

  return {
    unmount() {
      unmounted = true;
      offSymbol();
      offTf();
      clearTimeout(pollTimer);
      chart.remove();
    },
  };
}

registerWidget({ id: 'chart', title: 'Chart', defaultSize: { w: 9, h: 12 }, mount });
