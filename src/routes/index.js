const express = require('express');
const authRoutes = require('./auth.routes');
const dashboardRoutes = require('./dashboard.routes');
const symbolsRoutes = require('./api/symbols.routes');
const candlesRoutes = require('./api/candles.routes');
const metricsRoutes = require('./api/metrics.routes');
const signalsRoutes = require('./api/signals.routes');
const alertsRoutes = require('./api/alerts.routes');
const orderbookRoutes = require('./api/orderbook.routes');
const settingsRoutes = require('./api/settings.routes');
const requireAuth = require('../middleware/requireAuth');
const env = require('../config/env');

const router = express.Router();

router.get('/', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/dashboard');
  res.render('home', {
    title: 'Charts, metrics, orderbook, and signal alerts',
    description: 'A live dashboard for blue-chip US stocks: computed metrics, deterministic and stochastic signal detection, and email alerts.',
  });
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /dashboard',
      'Disallow: /settings',
      'Disallow: /api/',
      'Disallow: /reset-password',
      'Disallow: /verify-email',
      '',
      `Sitemap: ${env.appBaseUrl}/sitemap.xml`,
      '',
    ].join('\n')
  );
});

router.get('/sitemap.xml', (req, res) => {
  const pages = ['/', '/login', '/signup', '/forgot-password'];
  const urls = pages.map((p) => `  <url><loc>${env.appBaseUrl}${p}</loc></url>`).join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
});

router.use('/', authRoutes);
router.use('/', dashboardRoutes);
router.use('/api/symbols', symbolsRoutes);
router.use('/api/candles', candlesRoutes);
router.use('/api/metrics', metricsRoutes);
router.use('/api/signals', signalsRoutes);
router.use('/api/alerts', alertsRoutes);
router.use('/api/orderbook', orderbookRoutes);
router.use('/api/settings', settingsRoutes);

router.get('/api/whoami', requireAuth, (req, res) => {
  res.json({ userId: req.session.userId, email: req.session.email });
});

module.exports = router;
