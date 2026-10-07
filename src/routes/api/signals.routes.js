const express = require('express');
const requireAuth = require('../../middleware/requireAuth');
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const alertEventsRepo = require('../../db/repositories/alertEvents.repo');
const { listSignals } = require('../../services/signals/catalog');

const router = express.Router();
router.use(requireAuth);

router.get('/catalog', (req, res) => {
  res.json({ signals: listSignals() });
});

router.get('/', async (req, res) => {
  const { symbol, assetClass } = req.query;
  if (!symbol || !assetClass) return res.status(400).json({ error: 'symbol and assetClass are required.' });
  const instrument = await instrumentsRepo.findBySymbol(symbol, assetClass);
  if (!instrument) return res.status(404).json({ error: 'Unknown instrument.' });
  const events = await alertEventsRepo.listRecentForInstrument(instrument.id, 30);
  res.json({ instrument, events });
});

module.exports = router;
