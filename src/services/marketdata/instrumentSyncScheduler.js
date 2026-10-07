// Runs instrumentSync.service's Alpaca asset discovery automatically once a
// day around midnight (local server time), so newly-listed stocks show up
// in search without anyone manually re-running "npm run seed:instruments".
const { syncInstruments } = require('./instrumentSync.service');

const RUN_AT_HOUR = 0;
const RUN_AT_MINUTE = 5; // a few minutes past midnight, clear of the exact date rollover

let timer = null;

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), RUN_AT_HOUR, RUN_AT_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function runOnce() {
  try {
    await syncInstruments();
  } catch (err) {
    console.error('[instrumentSyncScheduler] sync failed:', err.message);
  }
}

function scheduleNext() {
  const delay = msUntilNextRun();
  console.log(`[instrumentSyncScheduler] next instrument sync in ${Math.round(delay / 60000)} min`);
  timer = setTimeout(async () => {
    await runOnce();
    scheduleNext();
  }, delay);
  timer.unref();
}

function start() {
  if (timer) return;
  scheduleNext();
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { start, stop, runOnce };
