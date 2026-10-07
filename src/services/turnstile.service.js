const https = require('https');
const env = require('../config/env');

function verifyOnce(token, remoteIp) {
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      secret: env.turnstileSecretKey,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    }).toString();

    const req = https.request(
      {
        hostname: 'challenges.cloudflare.com',
        path: '/turnstile/v0/siteverify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(!!parsed.success);
          } catch (err) {
            resolve(false);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

async function verify(token, remoteIp) {
  if (!env.turnstileSecretKey) {
    // No TURNSTILE_SECRET_KEY configured yet (local dev) -- skip
    // verification so the auth flow is still fully testable without a
    // Cloudflare account.
    return true;
  }
  if (!token) return false;
  return verifyOnce(token, remoteIp);
}

module.exports = { verify };
