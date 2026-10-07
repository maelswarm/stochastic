import { bus } from './bus.js';
import { Grid } from './grid.js';
import { listWidgets, getWidget } from './registry.js';

import './modules/watchlist.js';
import './modules/chart.js';
import './modules/metrics.js';
import './modules/orderbook.js';
import './modules/tape.js';
import './modules/signals.js';
import './modules/alerts.js';

// Orderbook and tape aren't in the default layout (stocks only get IEX
// top-of-book, no depth or trade stream) -- both stay available via
// "+ Widget" for anyone who wants them.
const DEFAULT_LAYOUT = [
  { widgetId: 'watchlist', x: 1, y: 1, w: 3, h: 20 },
  { widgetId: 'chart', x: 4, y: 1, w: 9, h: 10 },
  { widgetId: 'metrics', x: 4, y: 11, w: 9, h: 4 },
  { widgetId: 'signals', x: 4, y: 15, w: 5, h: 6 },
  { widgetId: 'alerts', x: 9, y: 15, w: 4, h: 6 },
].filter((entry) => getWidget(entry.widgetId));

let saveTimer = null;
function persistLayout(layout) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    bus.request('/api/settings/layout', { method: 'PATCH', body: { layout } }).catch(() => {});
  }, 800);
}

const gridEl = document.getElementById('widget-grid');
const template = document.getElementById('widget-frame-template');
const grid = new Grid(gridEl, { template, onLayoutChange: persistLayout });

async function init() {
  let layout = null;
  try {
    const data = await bus.request('/api/settings/layout');
    layout = data.layout;
  } catch (err) {
    /* fall through to default */
  }
  const initial = (Array.isArray(layout) && layout.length > 0 ? layout : DEFAULT_LAYOUT)
    .filter((entry) => getWidget(entry.widgetId));
  grid.setLayout(initial);
}

// ---- toolbar: symbol search ------------------------------------------------
const searchInput = document.getElementById('symbol-search');
const resultsEl = document.getElementById('symbol-results');
const activeDisplay = document.getElementById('active-symbol-display');
let searchTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length === 0) {
    resultsEl.hidden = true;
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const data = await bus.request(`/api/symbols/search?q=${encodeURIComponent(q)}`);
      renderResults(data.results);
    } catch (err) {
      resultsEl.hidden = true;
    }
  }, 200);
});

document.addEventListener('click', (ev) => {
  if (!resultsEl.contains(ev.target) && ev.target !== searchInput) resultsEl.hidden = true;
});

function renderResults(results) {
  resultsEl.innerHTML = '';
  if (results.length === 0) {
    resultsEl.hidden = true;
    return;
  }
  for (const instrument of results) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'symbol-result-row';
    row.innerHTML = `<span class="sr-symbol">${instrument.symbol}</span><span class="sr-name">${instrument.name}</span><span class="sr-class">${instrument.asset_class}</span>`;
    row.addEventListener('click', async () => {
      bus.setActiveSymbol(instrument);
      searchInput.value = '';
      resultsEl.hidden = true;
      try {
        await bus.request('/api/symbols/watchlist', { method: 'POST', body: { instrumentId: instrument.id } });
        bus.emit('watchlist:added', { instrument });
      } catch (err) {
        /* already on watchlist or failed silently -- not critical */
      }
    });
    resultsEl.appendChild(row);
  }
  resultsEl.hidden = false;
}

bus.on('symbol:changed', ({ detail }) => {
  const { instrument } = detail;
  activeDisplay.querySelector('.active-symbol-name').textContent = instrument ? instrument.symbol : '—';
});

// ---- toolbar: timeframe switcher -------------------------------------------
const tfSwitcher = document.getElementById('timeframe-switcher');
tfSwitcher.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-tf]');
  if (!btn) return;
  tfSwitcher.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  bus.setTimeframe(btn.dataset.tf);
});

// ---- toolbar: connection status --------------------------------------------
const connStatus = document.getElementById('conn-status');
bus.on('conn:changed', ({ detail }) => {
  connStatus.dataset.state = detail.state;
  connStatus.textContent = `● ${detail.state === 'open' ? 'live' : detail.state}`;
});

// ---- toolbar: add widget / reset layout ------------------------------------
document.getElementById('add-widget-btn').addEventListener('click', () => {
  const available = listWidgets().filter((w) => !grid.items.has(w.id));
  if (available.length === 0) {
    alert('All available widgets are already on your dashboard.');
    return;
  }
  const choice = prompt(`Add which widget?\n${available.map((w) => `- ${w.id}: ${w.title}`).join('\n')}`);
  if (choice && getWidget(choice.trim())) grid.addWidget(choice.trim());
});

document.getElementById('reset-layout-btn').addEventListener('click', () => {
  if (!confirm('Reset dashboard layout to default?')) return;
  grid.setLayout(DEFAULT_LAYOUT);
  persistLayout(grid.getLayout());
});

// ---- notification bell ------------------------------------------------
const notifBell = document.getElementById('notif-bell');
const notifPanel = document.getElementById('notif-panel');
const notifBadge = document.getElementById('notif-badge');
const notifList = document.getElementById('notif-list');

function setBadge(count) {
  notifBadge.textContent = String(count);
  notifBadge.hidden = count === 0;
}

function renderNotification(item) {
  const row = document.createElement('div');
  row.className = `notif-item${item.read_at ? '' : ' unread'}`;
  const when = new Date(item.triggered_at || item.created_at).toLocaleString();
  row.innerHTML = `<div class="notif-item-title">${item.symbol}: ${item.payload?.message || item.signal_key}</div><div class="notif-item-time">${when}</div>`;
  return row;
}

async function loadNotifications() {
  try {
    const data = await bus.request('/api/alerts/notifications/feed');
    setBadge(data.unread);
    notifList.innerHTML = '';
    if (data.items.length === 0) {
      notifList.innerHTML = '<p class="widget-empty">No notifications yet.</p>';
    } else {
      for (const item of data.items) notifList.appendChild(renderNotification(item));
    }
  } catch (err) {
    /* auth not ready yet on first paint -- ignore */
  }
}

notifBell.addEventListener('click', () => {
  notifPanel.hidden = !notifPanel.hidden;
  if (!notifPanel.hidden) loadNotifications();
});
document.addEventListener('click', (ev) => {
  if (notifPanel.hidden) return;
  if (!notifPanel.contains(ev.target) && ev.target !== notifBell && !notifBell.contains(ev.target)) {
    notifPanel.hidden = true;
  }
});
document.getElementById('notif-mark-all').addEventListener('click', async () => {
  await bus.request('/api/alerts/notifications/read-all', { method: 'POST' });
  loadNotifications();
});

bus.on('ws:*', (ev) => {
  if (ev.detail.type !== 'signal') return;
  setBadge(Number(notifBadge.textContent || '0') + 1);
});

bus.connect();
init();
loadNotifications();
