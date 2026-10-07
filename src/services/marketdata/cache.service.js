// Read-through candle cache: the API and dashboard only ever read from
// Postgres (candles.repo); this module is the only thing that talks to a
// live provider to keep that cache warm. One user's fetch backfills the
// table for everyone -- the 1 Hz-per-key budget is spent once per
// (instrument, timeframe), not once per viewer.
const candlesRepo = require('../../db/repositories/candles.repo');
const marketdata = require('./index');
const budget = require('./budget.service');

// How long a cached timeframe is trusted before the scheduler/on-demand
// fetch will hit Alpaca again for it. These used to assume a user might
// have dozens of symbols sharing the 1 req/sec-per-key budget, so longer
// timeframes were throttled hard (1D was 6h) -- with realistic watchlist
// sizes that budget has plenty of headroom, so these are now close to how
// often each timeframe's bar can actually change instead of an arbitrary
// conservative ceiling.
const STALE_MS = {
  '1m': 15 * 1000,
  '5m': 30 * 1000,
  '15m': 60 * 1000,
  '1h': 2 * 60 * 1000,
  '4h': 5 * 60 * 1000,
  '1D': 60 * 1000,
  '1W': 5 * 60 * 1000,
};

function isStale(syncState, timeframe) {
  if (!syncState || !syncState.last_synced_at) return true;
  return Date.now() - new Date(syncState.last_synced_at).getTime() > STALE_MS[timeframe];
}

async function refreshLatest(userId, instrument, timeframe, { limit, lane } = {}) {
  const bars = await marketdata.getCandles(userId, instrument, timeframe, { limit: limit || 200, lane });
  if (bars.length > 0) {
    await candlesRepo.upsertMany(instrument.id, timeframe, bars);
    await candlesRepo.setSyncState(instrument.id, timeframe, { lastBarTs: bars[bars.length - 1].ts });
  }
  return bars;
}

// Returns cached candles immediately; if the cache looks stale, kicks off a
// background refresh (not awaited) rather than making the caller wait on a
// live provider round-trip.
//
// Shallow-cache healing: Alpaca bills by request, not by bar -- fetching
// 400 bars costs the same one request as fetching 5. So whenever the cached
// series is shallower than the caller wants, refresh at full depth instead
// of the cheap tail refresh. Without this, a series that ever got a partial
// fetch (e.g. one bar) would only ever gain 5 recent bars per refresh and
// could stay below the ~20-bar minimum that metrics/signals need forever.
async function getCandles(userId, instrument, timeframe, { limit = 300 } = {}) {
  let rows = await candlesRepo.getLatest(instrument.id, timeframe, limit);

  if (rows.length < Math.min(20, limit)) {
    // Nothing cached (or too few bars to compute/draw anything meaningful)
    // -- this one call has to wait on the provider.
    await refreshLatest(userId, instrument, timeframe, { limit });
    rows = await candlesRepo.getLatest(instrument.id, timeframe, limit);
    return rows;
  }

  const syncState = await candlesRepo.getSyncState(instrument.id, timeframe);
  if (isStale(syncState, timeframe)) {
    const refreshLimit = rows.length < limit ? limit : 5;
    refreshLatest(userId, instrument, timeframe, { limit: refreshLimit }).catch((err) => {
      console.warn(`[cache] background refresh failed for ${instrument.symbol} ${timeframe}: ${err.message}`);
    });
  }

  return rows;
}

// For the symbol actively displayed on someone's chart right now: fetches
// fresh when this user's 1/sec budget has a free slot, otherwise serves
// cache immediately. Critically it must NEVER wait in budget.acquire()'s
// queue -- a frontend polling every second would stack requests behind each
// other faster than they drain, and every response would arrive too late to
// be useful (this exact livelock shipped once). Skipping a fetch is fine:
// the next poll, one second later, gets the free slot. NO_KEY still
// propagates when the cache is empty (the route needs it to prompt for a
// key); other fetch errors fall back to cache so a transient hiccup doesn't
// blank out a chart that was working a second ago.
async function getLiveCandles(userId, instrument, timeframe, { limit = 300 } = {}) {
  const cachedCount = await candlesRepo.countBars(instrument.id, timeframe, limit);
  // A shallow cache (fewer bars than the chart wants) gets a full-depth
  // refresh -- same single API request as a tail refresh, and it self-heals
  // a series that previously only got a partial fetch.
  const refreshLimit = cachedCount < limit ? limit : Math.min(limit, 10);
  const provider = marketdata.providerFor(instrument);
  const shouldFetch = cachedCount === 0 || (provider && budget.canRequestNow(userId, provider, 'live'));
  if (shouldFetch) {
    try {
      await refreshLatest(userId, instrument, timeframe, { limit: refreshLimit, lane: 'live' });
    } catch (err) {
      if (err.code === 'NO_KEY' && cachedCount === 0) throw err;
      if (err.code !== 'NO_KEY') console.warn(`[cache] live refresh failed for ${instrument.symbol} ${timeframe}: ${err.message}`);
    }
  }
  return candlesRepo.getLatest(instrument.id, timeframe, limit);
}

module.exports = { getCandles, getLiveCandles, refreshLatest, isStale, STALE_MS };
