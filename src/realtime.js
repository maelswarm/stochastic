// WebSocket hub for the dashboard's data bus (public/js/dashboard/bus.js).
// One hub, many topic-based rooms: clients subscribe to topics like
// "quote:AAPL", "orderbook:BTCUSDT", "signals:<userId>" and the server
// pushes JSON frames {topic, type, data} to every subscriber. Server-side
// services (scheduler, dispatcher, orderbook proxies) call broadcast()
// directly -- they don't know or care who's listening.
//
// WebSocket upgrades happen before Express's session middleware ever runs,
// so the session cookie is authenticated manually here: verify its HMAC
// signature (same scheme express-session uses internally, via the
// cookie-signature package it already depends on) to recover the raw
// session id, then look that row up directly in the `session` table
// (connect-pg-simple's own table) to confirm it belongs to a logged-in user.
const { WebSocketServer } = require('ws');
const { EventEmitter } = require('events');
const cookieSignature = require('cookie-signature');
const pool = require('./db/pool');
const env = require('./config/env');

const SESSION_COOKIE_NAME = 'stoch.sid';
const subscribersByTopic = new Map();
let wss = null;

// Fires 'topic:active' the moment a topic gets its first subscriber and
// 'topic:inactive' when it loses its last one. Upstream proxies (e.g.
// binanceStream.service.js) listen here instead of realtime.js knowing
// anything about them, so a crypto orderbook websocket only stays open
// while at least one dashboard client actually has it in view.
const topicEvents = new EventEmitter();

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  });
  return out;
}

function extractSessionId(cookieHeader) {
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const value = raw.startsWith('s:') ? raw.slice(2) : raw;
  const sid = cookieSignature.unsign(value, env.sessionSecret);
  return sid || null;
}

async function authenticate(cookieHeader) {
  const sid = extractSessionId(cookieHeader);
  if (!sid) return null;
  const { rows } = await pool.query(
    'SELECT sess FROM session WHERE sid = $1 AND expire > now()',
    [sid]
  );
  const sess = rows[0] && rows[0].sess;
  if (!sess || !sess.userId) return null;
  return { userId: sess.userId };
}

function subscribe(topic, ws) {
  const isNewTopic = !subscribersByTopic.has(topic);
  if (isNewTopic) subscribersByTopic.set(topic, new Set());
  subscribersByTopic.get(topic).add(ws);
  ws.topics.add(topic);
  if (isNewTopic) topicEvents.emit('topic:active', topic);
}

function unsubscribe(topic, ws) {
  const room = subscribersByTopic.get(topic);
  if (!room) return;
  room.delete(ws);
  ws.topics.delete(topic);
  if (room.size === 0) {
    subscribersByTopic.delete(topic);
    topicEvents.emit('topic:inactive', topic);
  }
}

function unsubscribeAll(ws) {
  for (const topic of Array.from(ws.topics)) unsubscribe(topic, ws);
}

// Called by server-side services (scheduler, dispatcher, orderbook proxy) to
// push a frame to everyone subscribed to `topic`. No-op if nobody's listening.
function broadcast(topic, type, data) {
  const room = subscribersByTopic.get(topic);
  if (!room || room.size === 0) return;
  const payload = JSON.stringify({ topic, type, data });
  for (const ws of room) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function broadcastToUser(userId, type, data) {
  broadcast(`user:${userId}`, type, data);
}

function hasSubscribers(topic) {
  const room = subscribersByTopic.get(topic);
  return !!room && room.size > 0;
}

function attach(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://internal');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    let user;
    try {
      user = await authenticate(req.headers.cookie);
    } catch (err) {
      socket.destroy();
      return;
    }
    if (!user) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = user.userId;
      ws.topics = new Set();
      subscribe(`user:${user.userId}`, ws);

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch (err) {
          return;
        }
        if (!msg || typeof msg.topic !== 'string') return;
        if (msg.type === 'subscribe') subscribe(msg.topic, ws);
        else if (msg.type === 'unsubscribe') unsubscribe(msg.topic, ws);
      });

      ws.on('close', () => unsubscribeAll(ws));
      ws.on('error', () => unsubscribeAll(ws));
    });
  });
}

module.exports = { attach, broadcast, broadcastToUser, hasSubscribers, topicEvents };
