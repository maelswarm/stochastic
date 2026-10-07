const express = require('express');
const requireAuth = require('../../middleware/requireAuth');
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const marketdata = require('../../services/marketdata');

const router = express.Router();
router.use(requireAuth);

// REST snapshot -- stocks only get a top-of-book quote (never full depth;
// see PLAN.md §2). Full L2 depth was crypto/Binance-only and is currently
// on hold (services/marketdata/index.js has the reasoning).
router.get('/', async (req, res) => {
  const { symbol, assetClass } = req.query;
  if (!symbol || !assetClass) return res.status(400).json({ error: 'symbol and assetClass are required.' });

  const instrument = await instrumentsRepo.findBySymbol(symbol, assetClass);
  if (!instrument) return res.status(404).json({ error: 'Unknown instrument.' });

  try {
    if (instrument.asset_class === 'stock') {
      const quote = await marketdata.getQuote(req.session.userId, instrument);
      return res.json({ instrument, kind: 'quote', quote });
    }
    res.json({ instrument, kind: 'unsupported' });
  } catch (err) {
    if (err.code === 'NO_KEY') {
      return res.status(409).json({ error: `Connect a ${err.provider} API key in Settings to load this data.`, code: 'NO_KEY', provider: err.provider });
    }
    if (err.code === 'RATE_LIMITED' || err.rateLimited) {
      return res.status(429).json({ error: 'Rate limited -- try again shortly.', code: 'RATE_LIMITED' });
    }
    console.error(err);
    res.status(502).json({ error: 'Failed to fetch orderbook.' });
  }
});

module.exports = router;
