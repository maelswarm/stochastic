const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const env = require('../config/env');

const router = express.Router();

router.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', {
    title: 'Dashboard',
    turnstileSiteKey: '',
  });
});

router.get('/settings', requireAuth, (req, res) => {
  res.render('settings', { title: 'Settings' });
});

module.exports = router;
