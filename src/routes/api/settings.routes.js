const express = require('express');
const requireAuth = require('../../middleware/requireAuth');
const apiKeysRepo = require('../../db/repositories/apiKeys.repo');
const dashboardLayoutsRepo = require('../../db/repositories/dashboardLayouts.repo');
const marketdata = require('../../services/marketdata');

const router = express.Router();
router.use(requireAuth);

const CREDENTIAL_FIELDS = {
  alpaca: ['keyId', 'secret'],
};

function extractCredentials(provider, body) {
  const fields = CREDENTIAL_FIELDS[provider];
  if (!fields) return null;
  const creds = {};
  for (const f of fields) {
    if (!body[f] || typeof body[f] !== 'string') return null;
    creds[f] = body[f].trim();
  }
  return creds;
}

router.get('/keys', async (req, res) => {
  const keys = await apiKeysRepo.listForUser(req.session.userId);
  res.json({ keys });
});

router.post('/keys', async (req, res) => {
  const provider = req.body.provider;
  if (!CREDENTIAL_FIELDS[provider]) {
    return res.status(400).json({ error: 'Unknown provider.' });
  }
  const credentials = extractCredentials(provider, req.body);
  if (!credentials) {
    return res.status(400).json({ error: 'Missing required key fields.' });
  }

  const testResult = await marketdata.testKey(provider, credentials).catch((err) => ({ ok: false, reason: 'error', detail: err.message }));
  const saved = await apiKeysRepo.upsertKey({ userId: req.session.userId, provider, credentials });
  if (!testResult.ok) {
    await apiKeysRepo.markStatus(req.session.userId, provider, testResult.reason === 'invalid' ? 'invalid' : 'rate_limited');
  }

  res.json({ key: { ...saved, status: testResult.ok ? 'ok' : (testResult.reason === 'invalid' ? 'invalid' : 'rate_limited') }, testResult });
});

router.post('/keys/:provider/test', async (req, res) => {
  const provider = req.params.provider;
  const row = await apiKeysRepo.getCredentials(req.session.userId, provider);
  if (!row) return res.status(404).json({ error: 'No key saved for this provider.' });

  const testResult = await marketdata.testKey(provider, row.credentials).catch((err) => ({ ok: false, reason: 'error', detail: err.message }));
  const status = testResult.ok ? 'ok' : testResult.reason === 'invalid' ? 'invalid' : 'rate_limited';
  await apiKeysRepo.markStatus(req.session.userId, provider, status);
  res.json({ status, testResult });
});

router.delete('/keys/:provider', async (req, res) => {
  await apiKeysRepo.deleteKey(req.session.userId, req.params.provider);
  res.json({ ok: true });
});

router.get('/layout', async (req, res) => {
  const layout = await dashboardLayoutsRepo.get(req.session.userId);
  res.json({ layout });
});

router.patch('/layout', async (req, res) => {
  if (!Array.isArray(req.body.layout)) {
    return res.status(400).json({ error: 'layout must be an array.' });
  }
  await dashboardLayoutsRepo.save(req.session.userId, req.body.layout);
  res.json({ ok: true });
});

module.exports = router;
