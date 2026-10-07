const express = require('express');
const requireAuth = require('../../middleware/requireAuth');
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const cacheService = require('../../services/marketdata/cache.service');
const marketdata = require('../../services/marketdata');
const metricsService = require('../../services/metrics.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { symbol, assetClass } = req.query;
  if (!symbol || !assetClass) return res.status(400).json({ error: 'symbol and assetClass are required.' });

  const instrument = await instrumentsRepo.findBySymbol(symbol, assetClass);
  if (!instrument) return res.status(404).json({ error: 'Unknown instrument.' });

  const provider = marketdata.providerFor(instrument);
  if (!provider) return res.status(503).json({ error: 'No data provider available for this instrument.' });

  try {
    await cacheService.getCandles(req.session.userId, instrument, '1D', { limit: 400 });

    let benchmarkCandles = null;
    if (instrument.symbol !== 'SPY' && instrument.asset_class === 'stock') {
      const spy = await instrumentsRepo.findBySymbol('SPY', 'stock');
      if (spy) {
        benchmarkCandles = await cacheService.getCandles(req.session.userId, spy, '1D', { limit: 400 }).catch(() => null);
      }
    }

    const metrics = await metricsService.computeMetrics(instrument, { benchmarkCandles });
    res.json({ instrument, metrics });
  } catch (err) {
    if (err.code === 'NO_KEY') {
      return res.status(409).json({ error: `Connect a ${err.provider} API key in Settings to load this data.`, code: 'NO_KEY', provider: err.provider });
    }
    if (err.code === 'RATE_LIMITED' || err.rateLimited) {
      return res.status(429).json({ error: 'Rate limited -- try again shortly.', code: 'RATE_LIMITED' });
    }
    console.error(err);
    res.status(502).json({ error: 'Failed to compute metrics.' });
  }
});

module.exports = router;
