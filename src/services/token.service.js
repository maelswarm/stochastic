const crypto = require('crypto');

const TTL_MS = {
  activation: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function expiryFor(purpose) {
  return new Date(Date.now() + TTL_MS[purpose]);
}

module.exports = { generateRawToken, hashToken, expiryFor };
