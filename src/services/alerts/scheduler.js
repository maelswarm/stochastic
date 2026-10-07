// Background trigger-check loop, working within the 200 req/min Alpaca key
// budget split in budget.service: the focused chart's live poll owns the
// 'live' lane (<= 60/min) and this scheduler owns the 'alerts' lane
// (<= 60/min, one fetch per second per user key), so trigger checking and
// the on-screen chart can never crowd each other out.
//
// Every 250ms scan:
//
//   1. build the candidate set: one candidate per unique
//      (user, instrument, timeframe) with an active alert rule. Watchlist
//      membership alone doesn't create candidates -- on-screen symbols are
//      kept fresh by the chart's own live poll instead.
//   2. round-robin refresh: per (user, provider), if that key's alert lane
//      has a free 1/sec slot, fetch the candidate after the last one served
//      (wrapping), skipping any whose cache is still fresh. Fair rotation
//      means every rule's series gets its turn no matter how many rules a
//      user has; pacing means the lane budget is never exceeded.
//   3. evaluate rules for any candidate whose cached series gained a new
//      closed bar since its last evaluation -- however the bar got there
//      (step 2's fetch, or the chart's live poll refreshing the shared
//      cache). Evaluation is decoupled from fetching on purpose: the
//      focused symbol's cache is kept perpetually fresh by the live poll,
//      so a scheduler that only evaluated after its own fetches would
//      silently stop checking triggers on whatever symbol is being watched.
const env = require('../../config/env');
const alertRulesRepo = require('../../db/repositories/alertRules.repo');
const candlesRepo = require('../../db/repositories/candles.repo');
const cacheService = require('../marketdata/cache.service');
const marketdata = require('../marketdata');
const budget = require('../marketdata/budget.service');
const engine = require('../signals/engine');
const dispatcher = require('./dispatcher');

const SCAN_INTERVAL_MS = 250;

let timer = null;
let scanning = false;

// `${instrumentId}:${timeframe}` -> bar ts (ms) already evaluated. In-memory:
// on restart the first sighting of each series just baselines (no evaluate),
// matching the old persisted-sync-state semantics of not re-firing on a bar
// that was already current before the restart.
const lastEvaluatedBarTs = new Map();
// `${userId}:${provider}` -> candidateKey served last, for round-robin.
const rrCursor = new Map();

function toInstrument(row) {
  return {
    id: row.instrument_id || row.id,
    symbol: row.symbol,
    asset_class: row.asset_class,
    provider_symbols: row.provider_symbols,
  };
}

function candidateKey(c) {
  return `${c.instrument.id}:${c.timeframe}`;
}

async function buildCandidates() {
  const activeRules = await alertRulesRepo.listActive();
  const byUserInstrTf = new Map();
  const rulesByInstrTf = new Map();

  for (const rule of activeRules) {
    const instrument = toInstrument(rule);
    const itKey = `${instrument.id}:${rule.timeframe}`;
    if (!rulesByInstrTf.has(itKey)) rulesByInstrTf.set(itKey, []);
    rulesByInstrTf.get(itKey).push(rule);

    const key = `${rule.user_id}:${itKey}`;
    if (!byUserInstrTf.has(key)) {
      byUserInstrTf.set(key, { userId: rule.user_id, instrument, timeframe: rule.timeframe });
    }
  }

  return { candidates: Array.from(byUserInstrTf.values()), rulesByInstrTf };
}

// Picks at most one stale candidate per (user, provider) -- the next one
// after that group's cursor -- and refreshes it on the alerts lane.
async function refreshRoundRobin(candidates, syncStates) {
  const groups = new Map();
  for (const c of candidates) {
    const provider = marketdata.providerFor(c.instrument);
    if (!provider) continue;
    if (!cacheService.isStale(syncStates.get(candidateKey(c)), c.timeframe)) continue;
    const gKey = `${c.userId}:${provider}`;
    if (!groups.has(gKey)) groups.set(gKey, []);
    groups.get(gKey).push({ ...c, provider });
  }

  const jobs = [];
  for (const [gKey, list] of groups) {
    const { userId, provider } = list[0];
    if (!budget.canRequestNow(userId, provider, 'alerts')) continue;
    list.sort((a, b) => (candidateKey(a) < candidateKey(b) ? -1 : 1));
    const lastServed = rrCursor.get(gKey);
    const next = (lastServed && list.find((c) => candidateKey(c) > lastServed)) || list[0];
    rrCursor.set(gKey, candidateKey(next));
    jobs.push(next);
  }

  await Promise.all(jobs.map(async (c) => {
    try {
      // Signals evaluate over up to 400 bars (engine.js); a series shallower
      // than that gets a full-depth refresh -- same single API request as a
      // tail refresh -- so rules on never-charted symbols can actually
      // accumulate enough history to evaluate instead of gaining 5 bars per
      // turn forever.
      const cached = await candlesRepo.countBars(c.instrument.id, c.timeframe, 400);
      const limit = cached < 400 ? 400 : 5;
      await cacheService.refreshLatest(c.userId, c.instrument, c.timeframe, { limit, lane: 'alerts' });
      syncStates.set(candidateKey(c), await candlesRepo.getSyncState(c.instrument.id, c.timeframe));
    } catch (err) {
      if (err.code !== 'NO_KEY') console.warn(`[scheduler] refresh failed for ${c.instrument.symbol} ${c.timeframe}: ${err.message}`);
    }
  }));
}

async function evaluateNewBars(candidates, rulesByInstrTf, syncStates) {
  const seen = new Set();
  for (const c of candidates) {
    const itKey = candidateKey(c);
    if (seen.has(itKey)) continue; // one evaluation covers every user's rules on this series
    seen.add(itKey);

    const syncState = syncStates.get(itKey);
    if (!syncState || !syncState.last_bar_ts) continue;
    const barTs = new Date(syncState.last_bar_ts).getTime();
    const lastEval = lastEvaluatedBarTs.get(itKey);
    if (lastEval !== undefined && barTs <= lastEval) continue;
    lastEvaluatedBarTs.set(itKey, barTs);
    if (lastEval === undefined) continue; // baseline on first sighting, don't re-fire on an old bar

    const rules = rulesByInstrTf.get(itKey) || [];
    if (rules.length === 0) continue;
    try {
      const detections = await engine.evaluateRules(c.instrument, c.timeframe, rules);
      if (detections.length > 0) await dispatcher.dispatch(c.instrument, detections);
    } catch (err) {
      console.error(`[scheduler] evaluate failed for ${c.instrument.symbol} ${c.timeframe}:`, err);
    }
  }
}

async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const { candidates, rulesByInstrTf } = await buildCandidates();
    if (candidates.length === 0) return;

    const syncStates = new Map();
    for (const c of candidates) {
      const k = candidateKey(c);
      if (!syncStates.has(k)) syncStates.set(k, await candlesRepo.getSyncState(c.instrument.id, c.timeframe));
    }

    await refreshRoundRobin(candidates, syncStates);
    await evaluateNewBars(candidates, rulesByInstrTf, syncStates);
  } catch (err) {
    console.error('[scheduler] scan failed:', err);
  } finally {
    scanning = false;
  }
}

function start() {
  if (timer) return;
  console.log(`[scheduler] starting (alerts lane: 1 fetch per ${env.pollIntervalMs}ms per key, round-robin; ${SCAN_INTERVAL_MS}ms scan interval)`);
  timer = setInterval(scan, SCAN_INTERVAL_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, scan };
