const express = require('express');
const requireAuth = require('../../middleware/requireAuth');
const alertRulesRepo = require('../../db/repositories/alertRules.repo');
const notificationsRepo = require('../../db/repositories/notifications.repo');
const instrumentsRepo = require('../../db/repositories/instruments.repo');
const emailService = require('../../services/email.service');
const { getSignal } = require('../../services/signals/catalog');

const router = express.Router();

// One-click "pause this rule" link from alert emails -- deliberately
// unauthenticated (the recipient may not have an active session) and
// verified instead via the HMAC token embedded in the email link.
router.get('/:id/pause', async (req, res) => {
  const rule = await alertRulesRepo.findById(Number(req.params.id));
  if (!rule) return res.status(404).send('Alert rule not found.');
  if (!emailService.verifyPauseToken(rule.user_id, rule.id, req.query.token || '')) {
    return res.status(403).send('Invalid or expired link.');
  }
  await alertRulesRepo.setActive(rule.id, rule.user_id, false);
  res.send('This alert has been paused. You can re-enable it from your dashboard.');
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  const rules = await alertRulesRepo.listForUser(req.session.userId);
  res.json({ rules });
});

router.post('/', async (req, res) => {
  const { instrumentId, signalKey, timeframe, params, cooldownMinutes, emailEnabled } = req.body;
  const signalDef = getSignal(signalKey);
  if (!signalDef) return res.status(400).json({ error: 'Unknown signal.' });
  const instrument = await instrumentsRepo.findById(Number(instrumentId));
  if (!instrument) return res.status(404).json({ error: 'Unknown instrument.' });

  const rule = await alertRulesRepo.create({
    userId: req.session.userId,
    instrumentId: instrument.id,
    signalKey,
    timeframe,
    params,
    cooldownMinutes,
    emailEnabled,
  });
  res.json({ rule });
});

router.patch('/:id', async (req, res) => {
  await alertRulesRepo.setActive(Number(req.params.id), req.session.userId, !!req.body.active);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await alertRulesRepo.remove(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

router.get('/notifications/feed', async (req, res) => {
  const [items, unread] = await Promise.all([
    notificationsRepo.listForUser(req.session.userId, 30),
    notificationsRepo.unreadCount(req.session.userId),
  ]);
  res.json({ items, unread });
});

router.post('/notifications/read-all', async (req, res) => {
  await notificationsRepo.markAllRead(req.session.userId);
  res.json({ ok: true });
});

router.post('/notifications/:id/read', async (req, res) => {
  await notificationsRepo.markRead(req.session.userId, Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
