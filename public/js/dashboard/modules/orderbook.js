import { bus } from '../bus.js';
import { registerWidget } from '../registry.js';

function fmt(x, decimals = 2) {
  return x === null || x === undefined ? '—' : Number(x).toFixed(decimals);
}

function mount(el) {
  const wrap = document.createElement('div');
  wrap.className = 'orderbook-widget';
  el.appendChild(wrap);

  let pollTimer = null;

  function renderQuote(quote) {
    wrap.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'orderbook-label';
    label.textContent = 'Top-of-book (Alpaca / IEX) — full depth unavailable for stocks';
    wrap.appendChild(label);

    if (!quote) {
      wrap.appendChild(Object.assign(document.createElement('p'), { className: 'widget-empty', textContent: 'No quote available.' }));
      return;
    }

    const row = document.createElement('div');
    row.className = 'orderbook-quote-row';
    row.innerHTML = `
      <div class="ob-quote-side"><span class="ob-quote-label">Bid</span><span class="ob-quote-price up">${fmt(quote.bidPrice)}</span><span class="ob-quote-size">${fmt(quote.bidSize, 0)}</span></div>
      <div class="ob-quote-side"><span class="ob-quote-label">Ask</span><span class="ob-quote-price down">${fmt(quote.askPrice)}</span><span class="ob-quote-size">${fmt(quote.askSize, 0)}</span></div>
    `;
    wrap.appendChild(row);
  }

  async function loadSnapshot(instrument) {
    try {
      const data = await bus.request(`/api/orderbook?symbol=${encodeURIComponent(instrument.symbol)}&assetClass=${instrument.asset_class}`);
      if (bus.activeInstrument !== instrument) return;
      if (data.kind === 'quote') renderQuote(data.quote);
      else wrap.innerHTML = '<p class="widget-empty">No orderbook data for this asset class.</p>';
    } catch (err) {
      if (err.code === 'NO_KEY') {
        wrap.innerHTML = `<p class="widget-empty">Connect a <strong>${err.data.provider}</strong> API key in <a href="/settings">Settings</a>.</p>`;
      } else {
        wrap.innerHTML = `<p class="widget-empty">${err.message || 'Failed to load orderbook.'}</p>`;
      }
    }
  }

  function teardown() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function load() {
    teardown();
    const instrument = bus.activeInstrument;
    if (!instrument) {
      wrap.innerHTML = '<p class="widget-empty">Pick a symbol to see its orderbook.</p>';
      return;
    }
    wrap.innerHTML = '<p class="widget-empty">Loading…</p>';
    loadSnapshot(instrument);

    if (instrument.asset_class === 'stock') {
      pollTimer = setInterval(() => loadSnapshot(instrument), 15000);
    }
  }

  const offSymbol = bus.on('symbol:changed', load);
  load();

  return {
    unmount() {
      offSymbol();
      teardown();
    },
  };
}

registerWidget({ id: 'orderbook', title: 'Orderbook', defaultSize: { w: 3, h: 10 }, mount });
