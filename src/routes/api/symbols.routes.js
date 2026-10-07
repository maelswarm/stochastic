const express = require('express');
const requireAuth = require('../../middleware/requireAuth');
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const watchlistRepo = require('../../db/repositories/watchlist.repo');

const router = express.Router();
router.use(requireAuth);

router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ results: [] });
  const results = await instrumentsRepo.search(q);
  res.json({ results });
});

router.get('/watchlist', async (req, res) => {
  const items = await watchlistRepo.listForUser(req.session.userId);
  res.json({ items });
});

router.post('/watchlist', async (req, res) => {
  const instrumentId = Number(req.body.instrumentId);
  if (!instrumentId) return res.status(400).json({ error: 'instrumentId is required.' });
  const instrument = await instrumentsRepo.findById(instrumentId);
  if (!instrument) return res.status(404).json({ error: 'Instrument not found.' });
  await watchlistRepo.add(req.session.userId, instrumentId);
  res.json({ ok: true });
});

router.delete('/watchlist/:instrumentId', async (req, res) => {
  await watchlistRepo.remove(req.session.userId, Number(req.params.instrumentId));
  res.json({ ok: true });
});

module.exports = router;
