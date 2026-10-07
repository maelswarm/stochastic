const PROVIDERS = [
  { id: 'alpaca', label: 'Alpaca', fields: [{ name: 'keyId', label: 'Key ID' }, { name: 'secret', label: 'Secret key' }], help: 'Free at alpaca.markets — create a paper trading account, then generate an API key pair.' },
];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function statusLabel(status) {
  return { ok: 'Connected', invalid: 'Invalid key', rate_limited: 'Rate limited', none: 'Not connected' }[status] || status;
}

async function render() {
  const container = document.getElementById('key-cards');
  container.innerHTML = '';
  const { keys } = await api('/api/settings/keys');
  const byProvider = Object.fromEntries(keys.map((k) => [k.provider, k]));

  for (const provider of PROVIDERS) {
    const existing = byProvider[provider.id];
    const card = document.createElement('div');
    card.className = 'key-card';

    const head = document.createElement('div');
    head.className = 'key-card-head';
    head.innerHTML = `<span class="key-card-provider">${provider.label}</span><span class="key-status" data-status="${existing ? existing.status : 'none'}">${statusLabel(existing ? existing.status : 'none')}</span>`;
    card.appendChild(head);

    const help = document.createElement('p');
    help.className = 'settings-hint';
    help.textContent = provider.help;
    card.appendChild(help);

    if (existing) {
      const info = document.createElement('p');
      info.className = 'settings-hint';
      info.textContent = `Key ending in •••• ${existing.key_last4}`;
      card.appendChild(info);
    }

    const inputs = {};
    for (const field of provider.fields) {
      const input = document.createElement('input');
      input.type = field.name.toLowerCase().includes('secret') || field.name === 'apiKey' ? 'password' : 'text';
      input.placeholder = existing ? `Update ${field.label}…` : field.label;
      input.autocomplete = 'off';
      inputs[field.name] = input;
      card.appendChild(input);
    }

    const actions = document.createElement('div');
    actions.className = 'key-card-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.textContent = existing ? 'Update key' : 'Save key';
    saveBtn.addEventListener('click', async () => {
      const body = { provider: provider.id };
      for (const field of provider.fields) body[field.name] = inputs[field.name].value;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Testing…';
      try {
        await api('/api/settings/keys', { method: 'POST', body });
        await render();
      } catch (err) {
        alert(err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = existing ? 'Update key' : 'Save key';
      }
    });
    actions.appendChild(saveBtn);

    if (existing) {
      const testBtn = document.createElement('button');
      testBtn.textContent = 'Test key';
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing…';
        try {
          await api(`/api/settings/keys/${provider.id}/test`, { method: 'POST' });
        } finally {
          await render();
        }
      });
      actions.appendChild(testBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger';
      deleteBtn.textContent = 'Remove';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Remove your ${provider.label} key?`)) return;
        await api(`/api/settings/keys/${provider.id}`, { method: 'DELETE' });
        await render();
      });
      actions.appendChild(deleteBtn);
    }

    card.appendChild(actions);
    container.appendChild(card);
  }
}

render();
