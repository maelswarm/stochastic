const express = require('express');
const requireAuth = require('../../middleware/requireAuth');
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const cacheService = require('../../services/marketdata/cache.service');
const marketdata = require('../../services/marketdata');

const router = express.Router();
router.use(requireAuth);

const VALID_TIMEFRAMES = new Set(['1m', '5m', '15m', '1h', '4h', '1D', '1W']);

router.get('/', async (req, res) => {
  const { symbol, assetClass } = req.query;
  const timeframe = req.query.tf || '1D';
  const limit = Math.min(Number(req.query.limit) || 300, 2000);

  if (!symbol || !assetClass) return res.status(400).json({ error: 'symbol and assetClass are required.' });
  if (!VALID_TIMEFRAMES.has(timeframe)) return res.status(400).json({ error: 'Invalid timeframe.' });

  const instrument = await instrumentsRepo.findBySymbol(symbol, assetClass);
  if (!instrument) return res.status(404).json({ error: 'Unknown instrument.' });

  const provider = marketdata.providerFor(instrument);
  if (!provider) return res.status(503).json({ error: 'No data provider available for this instrument.' });

  const live = req.query.live === '1';

  try {
    const candles = live
      ? await cacheService.getLiveCandles(req.session.userId, instrument, timeframe, { limit })
      : await cacheService.getCandles(req.session.userId, instrument, timeframe, { limit });
    res.json({ instrument, timeframe, candles });
  } catch (err) {
    if (err.code === 'NO_KEY') {
      return res.status(409).json({ error: `Connect a ${err.provider} API key in Settings to load this data.`, code: 'NO_KEY', provider: err.provider });
    }
    if (err.code === 'RATE_LIMITED' || err.rateLimited) {
      return res.status(429).json({ error: 'Rate limited -- try again shortly.', code: 'RATE_LIMITED' });
    }
    console.error(err);
    res.status(502).json({ error: 'Failed to fetch market data.' });
  }
});

module.exports = router;
