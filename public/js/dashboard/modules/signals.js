import { bus } from '../bus.js';
import { registerWidget } from '../registry.js';

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function mount(el) {
  const list = document.createElement('div');
  list.className = 'signal-feed';
  el.appendChild(list);

  let currentInstrumentId = null;
  let unsubscribeWs = null;

  function renderRow(event) {
    const row = document.createElement('div');
    row.className = `signal-row signal-${event.payload?.direction || event.direction || 'neutral'}`;
    const name = event.signal_key || event.signalKey;
    const message = event.payload?.message || event.message || '';
    const when = event.triggered_at || event.triggeredAt;
    row.innerHTML = `
      <div class="signal-row-top"><span class="signal-name">${name}</span><span class="signal-time">${timeAgo(when)}</span></div>
      <div class="signal-message">${message}</div>
    `;
    return row;
  }

  async function load() {
    const instrument = bus.activeInstrument;
    if (!instrument) {
      list.innerHTML = '<p class="widget-empty">Pick a symbol to see its signal history.</p>';
      return;
    }
    currentInstrumentId = instrument.id;
    list.innerHTML = '<p class="widget-empty">Loading…</p>';
    try {
      const data = await bus.request(`/api/signals?symbol=${encodeURIComponent(instrument.symbol)}&assetClass=${instrument.asset_class}`);
      list.innerHTML = '';
      if (data.events.length === 0) {
        list.innerHTML = '<p class="widget-empty">No signals detected yet for this symbol.</p>';
      } else {
        for (const event of data.events) list.appendChild(renderRow(event));
      }
    } catch (err) {
      list.innerHTML = `<p class="widget-empty">${err.message || 'Failed to load signal history.'}</p>`;
    }

    if (unsubscribeWs) unsubscribeWs();
    const topic = `signals:${instrument.id}`;
    bus.subscribeTopic(topic);
    unsubscribeWs = bus.on(`ws:${topic}`, (ev) => {
      if (currentInstrumentId !== instrument.id) return;
      const empty = list.querySelector('.widget-empty');
      if (empty) empty.remove();
      list.insertBefore(renderRow(ev.detail.data), list.firstChild);
    });
  }

  const offSymbol = bus.on('symbol:changed', load);
  load();

  return {
    unmount() {
      offSymbol();
      if (unsubscribeWs) unsubscribeWs();
    },
  };
}

registerWidget({ id: 'signals', title: 'Signal Feed', defaultSize: { w: 5, h: 6 }, mount });
