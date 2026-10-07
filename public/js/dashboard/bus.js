// Shared pub/sub data bus. Widgets never fetch or open sockets directly --
// they subscribe to bus events and call bus.request()/bus.setActiveSymbol()
// etc. This is what keeps widgets independently addable/removable: none of
// them know about each other, only about the bus.
class Bus extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.wsTopics = new Set();
    this.activeInstrument = null;
    this.activeTimeframe = '1D';
    this._reconnectDelay = 1000;
  }

  // ---- REST convenience -------------------------------------------------
  async request(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = data.code;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---- symbol / timeframe state -----------------------------------------
  setActiveSymbol(instrument) {
    this.activeInstrument = instrument;
    this.emit('symbol:changed', { instrument });
  }

  setTimeframe(tf) {
    this.activeTimeframe = tf;
    this.emit('timeframe:changed', { timeframe: tf });
  }

  // ---- pub/sub ------------------------------------------------------------
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  on(type, handler) {
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }

  // ---- websocket -----------------------------------------------------------
  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);

    this.ws.addEventListener('open', () => {
      this._reconnectDelay = 1000;
      this.emit('conn:changed', { state: 'open' });
      for (const topic of this.wsTopics) this._sendSubscribe(topic);
    });

    this.ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (err) {
        return;
      }
      this.emit(`ws:${msg.topic}`, msg);
      this.emit('ws:*', msg);
    });

    this.ws.addEventListener('close', () => {
      this.emit('conn:changed', { state: 'closed' });
      setTimeout(() => this.connect(), this._reconnectDelay);
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 15000);
    });

    this.ws.addEventListener('error', () => {
      this.emit('conn:changed', { state: 'error' });
    });
  }

  _sendSubscribe(topic) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', topic }));
    }
  }

  subscribeTopic(topic) {
    if (this.wsTopics.has(topic)) return;
    this.wsTopics.add(topic);
    this._sendSubscribe(topic);
  }

  unsubscribeTopic(topic) {
    if (!this.wsTopics.has(topic)) return;
    this.wsTopics.delete(topic);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', topic }));
    }
  }
}

export const bus = new Bus();
