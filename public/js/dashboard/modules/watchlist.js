import { bus } from '../bus.js';
import { registerWidget } from '../registry.js';

function mount(el) {
  const list = document.createElement('div');
  list.className = 'watchlist';
  el.appendChild(list);

  let items = [];

  function render() {
    list.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'widget-empty';
      empty.textContent = 'No symbols yet. Use the search bar above to add one.';
      list.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'watchlist-row';
      if (bus.activeInstrument && bus.activeInstrument.id === item.id) row.classList.add('active');

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'watchlist-symbol';
      label.innerHTML = `<span class="wl-symbol">${item.symbol}</span><span class="wl-name">${item.name}</span>`;
      label.addEventListener('click', () => bus.setActiveSymbol(item));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'watchlist-remove';
      removeBtn.setAttribute('aria-label', `Remove ${item.symbol}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', async () => {
        await bus.request(`/api/symbols/watchlist/${item.id}`, { method: 'DELETE' });
        items = items.filter((i) => i.id !== item.id);
        render();
      });

      row.appendChild(label);
      row.appendChild(removeBtn);
      list.appendChild(row);
    }
  }

  async function load() {
    try {
      const data = await bus.request('/api/symbols/watchlist');
      items = data.items;
      render();
      if (!bus.activeInstrument && items.length > 0) bus.setActiveSymbol(items[0]);
    } catch (err) {
      list.textContent = 'Failed to load watchlist.';
    }
  }

  const offSymbol = bus.on('symbol:changed', render);
  const offAdded = bus.on('watchlist:added', (ev) => {
    if (!items.some((i) => i.id === ev.detail.instrument.id)) {
      items = [...items, ev.detail.instrument];
      render();
    }
  });

  load();

  return {
    unmount() {
      offSymbol();
      offAdded();
    },
  };
}

registerWidget({ id: 'watchlist', title: 'Watchlist', defaultSize: { w: 3, h: 12 }, mount });
