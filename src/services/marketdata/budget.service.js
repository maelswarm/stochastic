// Per-(user, provider) request budgeting. Alpaca's free tier allows 200
// requests/minute per key; that budget is split into independently-paced
// lanes so background work can never crowd out the chart or vice versa:
//
//   'live'   -- user-facing fetches: the focused chart's 1/sec poll,
//               on-demand candle/metric loads, quote polls. One request per
//               POLL_INTERVAL_MS (1s) -> <= 60/min.
//   'alerts' -- the trigger scheduler's round-robin series refreshes.
//               Same 1/sec pacing -> <= 60/min.
//
// Worst case both lanes saturated is ~120/min; a 190/min sliding-window cap
// per key backstops everything (10/min slack under Alpaca's 200) in case
// more callers appear later. In-memory is fine -- this is a single-process
// app and the budget only needs to survive for the life of the process.
const env = require('../../config/env');

const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_MAX_PER_WINDOW = 190;

const lastRequestAt = new Map(); // `${userId}:${provider}:${lane}` -> ms epoch
const requestLog = new Map(); // `${userId}:${provider}` -> [ms epochs, oldest first]
const rateLimitedUntil = new Map();

function keyFor(userId, provider) {
  return `${userId}:${provider}`;
}

function laneKeyFor(userId, provider, lane) {
  return `${userId}:${provider}:${lane}`;
}

// Prunes entries older than the window and returns the live array (safe to
// push onto -- it's the same array stored in the map).
function prunedLog(userId, provider) {
  const key = keyFor(userId, provider);
  const cutoff = Date.now() - GLOBAL_WINDOW_MS;
  const log = (requestLog.get(key) || []).filter((ts) => ts > cutoff);
  requestLog.set(key, log);
  return log;
}

function isRateLimited(userId, provider) {
  const until = rateLimitedUntil.get(keyFor(userId, provider));
  return !!until && until > Date.now();
}

function markRateLimited(userId, provider, forMs = 60000) {
  rateLimitedUntil.set(keyFor(userId, provider), Date.now() + forMs);
}

function clearRateLimit(userId, provider) {
  rateLimitedUntil.delete(keyFor(userId, provider));
}

function canRequestNow(userId, provider, lane = 'live') {
  if (isRateLimited(userId, provider)) return false;
  if (prunedLog(userId, provider).length >= GLOBAL_MAX_PER_WINDOW) return false;
  const last = lastRequestAt.get(laneKeyFor(userId, provider, lane)) || 0;
  return Date.now() - last >= env.pollIntervalMs;
}

function recordRequest(userId, provider, lane = 'live') {
  const now = Date.now();
  lastRequestAt.set(laneKeyFor(userId, provider, lane), now);
  prunedLog(userId, provider).push(now);
}

// Resolves once it's this caller's turn in its lane and the per-key global
// window has room. Callers that can tolerate skipping a turn (both pollers)
// should check canRequestNow() first instead of awaiting this, so a busy
// tick doesn't pile up backlog.
async function acquire(userId, provider, lane = 'live') {
  const lk = laneKeyFor(userId, provider, lane);
  const last = lastRequestAt.get(lk) || 0;
  const laneWait = Math.max(0, last + env.pollIntervalMs - Date.now());
  if (laneWait > 0) await new Promise((r) => setTimeout(r, laneWait));

  // Global-window backstop: should essentially never engage given the lane
  // pacing above, but if it does, wait for the oldest request to age out.
  for (;;) {
    const log = prunedLog(userId, provider);
    if (log.length < GLOBAL_MAX_PER_WINDOW) break;
    const wait = Math.max(50, log[0] + GLOBAL_WINDOW_MS - Date.now());
    await new Promise((r) => setTimeout(r, wait));
  }

  recordRequest(userId, provider, lane);
}

module.exports = { acquire, canRequestNow, recordRequest, isRateLimited, markRateLimited, clearRateLimit };
