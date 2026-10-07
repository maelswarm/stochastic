// Proxies Binance's public combined depth+trade websocket into the
// dashboard's own ws hub: one upstream connection per crypto instrument,
// shared across every viewing client, opened lazily on first subscriber
// and closed once the last one leaves (PLAN.md §3 "Live UI").
const WebSocket = require('ws');
const realtime = require('../../realtime');
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const binanceAdapter = require('./binance.adapter');

const RECONNECT_DELAY_MS = 2000;
const streamsByInstrumentId = new Map(); // instrumentId -> { ws, instrument }

function parseTopic(topic) {
  const m = /^(?:orderbook|tape):(\d+)$/.exec(topic);
  return m ? Number(m[1]) : null;
}

function stillWanted(instrumentId) {
  return realtime.hasSubscribers(`orderbook:${instrumentId}`) || realtime.hasSubscribers(`tape:${instrumentId}`);
}

function connect(instrument) {
  const ws = new WebSocket(binanceAdapter.streamUrl(instrument));
  streamsByInstrumentId.set(instrument.id, { ws, instrument });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }
    const stream = msg.stream || '';
    const data = msg.data;
    if (!data) return;

    if (stream.endsWith('@trade')) {
      realtime.broadcast(`tape:${instrument.id}`, 'trade', {
        price: Number(data.p),
        qty: Number(data.q),
        side: data.m ? 'sell' : 'buy', // m = true -> buyer is the market maker -> aggressor sold
        ts: data.T,
      });
    } else if (stream.includes('@depth')) {
      realtime.broadcast(`orderbook:${instrument.id}`, 'snapshot', {
        bids: (data.bids || []).map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
        asks: (data.asks || []).map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
      });
    }
  });

  ws.on('close', () => {
    streamsByInstrumentId.delete(instrument.id);
    if (stillWanted(instrument.id)) setTimeout(() => connect(instrument), RECONNECT_DELAY_MS);
  });
  ws.on('error', () => ws.close());
}

async function ensureStream(instrumentId) {
  if (streamsByInstrumentId.has(instrumentId)) return;
  const instrument = await instrumentsRepo.findById(instrumentId);
  if (!instrument || instrument.asset_class !== 'crypto') return;
  connect(instrument);
}

function maybeCloseStream(instrumentId) {
  if (stillWanted(instrumentId)) return;
  const entry = streamsByInstrumentId.get(instrumentId);
  if (entry) {
    entry.ws.removeAllListeners('close');
    entry.ws.close();
    streamsByInstrumentId.delete(instrumentId);
  }
}

realtime.topicEvents.on('topic:active', (topic) => {
  const instrumentId = parseTopic(topic);
  if (instrumentId !== null) ensureStream(instrumentId).catch((err) => console.error('[binanceStream] ensureStream failed:', err));
});

realtime.topicEvents.on('topic:inactive', (topic) => {
  const instrumentId = parseTopic(topic);
  if (instrumentId !== null) maybeCloseStream(instrumentId);
});

module.exports = {};
