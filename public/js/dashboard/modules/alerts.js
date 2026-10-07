import { bus } from '../bus.js';
import { registerWidget } from '../registry.js';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'];
let catalogPromise = null;

function loadCatalog() {
  if (!catalogPromise) catalogPromise = bus.request('/api/signals/catalog').then((d) => d.signals);
  return catalogPromise;
}

function mount(el) {
  const wrap = document.createElement('div');
  wrap.className = 'alerts-widget';
  el.appendChild(wrap);

  async function load() {
    const instrument = bus.activeInstrument;
    if (!instrument) {
      wrap.innerHTML = '<p class="widget-empty">Pick a symbol to manage alerts.</p>';
      return;
    }
    wrap.innerHTML = '<p class="widget-empty">Loading…</p>';

    const [catalog, allRules] = await Promise.all([loadCatalog(), bus.request('/api/alerts').then((d) => d.rules)]);
    const rules = allRules.filter((r) => r.instrument_id === instrument.id);

    wrap.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'alert-rule-list';
    if (rules.length === 0) {
      list.innerHTML = '<p class="widget-empty">No alert rules for this symbol yet.</p>';
    } else {
      for (const rule of rules) list.appendChild(renderRule(rule, catalog, load));
    }
    wrap.appendChild(list);
    wrap.appendChild(renderAddForm(instrument, catalog, load));
  }

  function renderRule(rule, catalog) {
    const def = catalog.find((s) => s.key === rule.signal_key);
    const row = document.createElement('div');
    row.className = 'alert-rule-row';
    row.innerHTML = `
      <div class="alert-rule-main">
        <span class="alert-rule-name">${def ? def.name : rule.signal_key}</span>
        <span class="alert-rule-tf">${rule.timeframe}</span>
      </div>
      <div class="alert-rule-actions">
        <label class="alert-rule-toggle"><input type="checkbox" ${rule.active ? 'checked' : ''}> active</label>
        <button type="button" class="alert-rule-delete" aria-label="Delete rule">×</button>
      </div>
    `;
    row.querySelector('.alert-rule-toggle input').addEventListener('change', async (ev) => {
      await bus.request(`/api/alerts/${rule.id}`, { method: 'PATCH', body: { active: ev.target.checked } });
    });
    row.querySelector('.alert-rule-delete').addEventListener('click', async () => {
      await bus.request(`/api/alerts/${rule.id}`, { method: 'DELETE' });
      row.remove();
    });
    return row;
  }

  function renderAddForm(instrument, catalog) {
    const form = document.createElement('form');
    form.className = 'alert-add-form';

    const signalSelect = document.createElement('select');
    for (const s of catalog) {
      const opt = document.createElement('option');
      opt.value = s.key;
      opt.textContent = `${s.class === 'stochastic' ? '∿' : '⟂'} ${s.name}`;
      signalSelect.appendChild(opt);
    }

    const tfSelect = document.createElement('select');
    for (const tf of TIMEFRAMES) {
      const opt = document.createElement('option');
      opt.value = tf;
      opt.textContent = tf;
      if (tf === '1D') opt.selected = true;
      tfSelect.appendChild(opt);
    }

    const emailLabel = document.createElement('label');
    emailLabel.className = 'alert-form-email';
    emailLabel.innerHTML = '<input type="checkbox" checked> email me';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Add alert';

    form.appendChild(signalSelect);
    form.appendChild(tfSelect);
    form.appendChild(emailLabel);
    form.appendChild(submitBtn);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      submitBtn.disabled = true;
      try {
        await bus.request('/api/alerts', {
          method: 'POST',
          body: {
            instrumentId: instrument.id,
            signalKey: signalSelect.value,
            timeframe: tfSelect.value,
            emailEnabled: emailLabel.querySelector('input').checked,
            cooldownMinutes: 60,
          },
        });
        await load();
      } finally {
        submitBtn.disabled = false;
      }
    });

    return form;
  }

  const offSymbol = bus.on('symbol:changed', load);
  load();

  return { unmount() { offSymbol(); } };
}

registerWidget({ id: 'alerts', title: 'My Alerts', defaultSize: { w: 4, h: 6 }, mount });
