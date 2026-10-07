import { bus } from '../bus.js';
import { registerWidget } from '../registry.js';

// No currently-active provider streams trades (that was crypto/Binance-only
// and is on hold -- see services/marketdata/index.js). This widget stays
// registered as an honest placeholder rather than removed outright, since
// re-enabling it later is just wiring a stream back into realtime.js.
function mount(el) {
  const wrap = document.createElement('div');
  wrap.className = 'tape-widget';
  el.appendChild(wrap);

  function load() {
    const instrument = bus.activeInstrument;
    wrap.innerHTML = instrument
      ? '<p class="widget-empty">Live trade tape isn\'t available yet -- it needs a streaming data feed, which none of the connected providers currently supply.</p>'
      : '<p class="widget-empty">Pick a symbol to see the trade tape.</p>';
  }

  const offSymbol = bus.on('symbol:changed', load);
  load();

  return { unmount() { offSymbol(); } };
}

registerWidget({ id: 'tape', title: 'Trade Tape', defaultSize: { w: 3, h: 4 }, mount });
