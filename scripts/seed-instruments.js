// Manual one-off run of instrument discovery -- see
// src/services/marketdata/instrumentSync.service.js for the actual logic
// (shared with the automatic daily sync in instrumentSyncScheduler.js).
require('../src/config/env').assertRequiredEnv();
const { syncInstruments } = require('../src/services/marketdata/instrumentSync.service');
const pool = require('../src/db/pool');

syncInstruments()
  .then(({ upserted, deactivated }) => {
    console.log(`Done: ${upserted} upserted, ${deactivated} deactivated.`);
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
