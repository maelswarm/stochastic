/*
 * stochastic server entrypoint.
 *
 *   node src/server.js                 # HTTPS on :443 + HTTP on :80 (HTTP -> HTTPS)
 *   HTTPS_PORT=8443 HTTP_PORT=8080 node src/server.js   # custom ports
 *   PORT=3000 node src/server.js       # HTTP-only on a single port (legacy/dev)
 *
 * TLS certificate selection:
 *   1. Let's Encrypt certs at /etc/letsencrypt/live/<DOMAIN>/ if present
 *      (production; DOMAIN defaults to stochastic.example, override with DOMAIN=).
 *   2. Otherwise a self-signed cert generated into ../certs via `openssl`
 *      (local development; browsers will warn once, then remember).
 *
 * Binds to 0.0.0.0 (all interfaces) by default; override with HOST=.
 * Ports 80/443 are privileged: run elevated, or override with HTTP_PORT/HTTPS_PORT
 * (what .env's PORT=3000 does today via the legacy single-port mode below).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const env = require('./config/env');

env.assertRequiredEnv();

const app = require('./app');
const realtime = require('./realtime');
const pollScheduler = require('./services/alerts/scheduler');
const instrumentSyncScheduler = require('./services/marketdata/instrumentSyncScheduler');
// Crypto's live orderbook/tape stream (services/marketdata/binanceStream.service.js)
// is on hold -- see services/marketdata/index.js -- so it's not loaded here.

const HOST = process.env.HOST || '0.0.0.0';
const DOMAIN = process.env.DOMAIN || 'stochastic.example';

// Production TLS (Let's Encrypt / certbot)
const LE_CERT = process.env.TLS_CERT || `/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`;
const LE_KEY = process.env.TLS_KEY || `/etc/letsencrypt/live/${DOMAIN}/privkey.pem`;
// Development TLS (self-signed fallback)
const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');

const HTTP_PORT = Number(process.env.HTTP_PORT || process.env.PORT || 80);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const HTTP_ONLY = !!process.env.PORT && !process.env.HTTPS_PORT; // legacy single-port mode

// --------------------------------------------------------------- TLS certificate
function generateSelfSigned() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const base = [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', KEY_FILE, '-out', CERT_FILE, '-days', '365', '-subj', '/CN=localhost',
  ];
  const withSan = base.concat(['-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
  for (const args of [withSan, base]) {
    try {
      execFileSync('openssl', args, { stdio: 'ignore' });
      return true;
    } catch (err) {
      /* try next / give up */
    }
  }
  return false;
}

// Prefer real Let's Encrypt certs (production); fall back to self-signed (dev).
function loadCerts() {
  if (fs.existsSync(LE_CERT) && fs.existsSync(LE_KEY)) {
    return { key: fs.readFileSync(LE_KEY), cert: fs.readFileSync(LE_CERT), source: 'letsencrypt' };
  }
  if ((fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE)) || generateSelfSigned()) {
    return { key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE), source: 'self-signed' };
  }
  return null;
}

// --------------------------------------------------------------- startup helpers
function onError(label, port) {
  return (err) => {
    if (err.code === 'EACCES') {
      console.error(`\n${label} port ${port} needs elevated privileges. ` +
        `Run as Administrator/sudo, or use ${label === 'HTTPS' ? 'HTTPS_PORT' : 'HTTP_PORT'}=<high port>.`);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`\n${label} port ${port} is already in use. Stop the other process or pick another port.`);
    } else {
      console.error(`\n${label} server error:`, err.message);
    }
    process.exitCode = 1;
  };
}

function start() {
  // Legacy single HTTP port mode (e.g. PORT=3000, today's dev default)
  if (HTTP_ONLY) {
    const httpServer = http.createServer(app)
      .listen(HTTP_PORT, HOST, () => console.log(`stochastic (HTTP) listening on http://localhost:${HTTP_PORT}`))
      .on('error', onError('HTTP', HTTP_PORT));
    realtime.attach(httpServer);
    pollScheduler.start();
    instrumentSyncScheduler.start();
    return;
  }

  const tls = loadCerts();

  if (tls) {
    const httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, app)
      .listen(HTTPS_PORT, HOST, () => console.log(`stochastic (HTTPS, ${tls.source}) listening on ${HOST}:${HTTPS_PORT}`))
      .on('error', onError('HTTPS', HTTPS_PORT));
    realtime.attach(httpsServer);
    pollScheduler.start();
    instrumentSyncScheduler.start();

    // HTTP -> HTTPS redirect
    http.createServer((req, res) => {
      const host = (req.headers.host || DOMAIN).replace(/:\d+$/, '');
      const suffix = HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT;
      res.writeHead(301, { Location: `https://${host}${suffix}${req.url}` });
      res.end();
    })
      .listen(HTTP_PORT, HOST, () => console.log(`HTTP on ${HOST}:${HTTP_PORT} redirects to HTTPS`))
      .on('error', onError('HTTP', HTTP_PORT));

    if (tls.source === 'self-signed') {
      console.log('Self-signed cert in use (dev) -- browsers will warn on first visit; accept to continue.');
    }
  } else {
    console.warn('No TLS cert available (openssl not found) -- serving plain HTTP.');
    const httpServer = http.createServer(app)
      .listen(HTTP_PORT, HOST, () => console.log(`stochastic (HTTP) listening on http://localhost:${HTTP_PORT}`))
      .on('error', onError('HTTP', HTTP_PORT));
    realtime.attach(httpServer);
    pollScheduler.start();
    instrumentSyncScheduler.start();
  }

  console.log('Press Ctrl+C to stop.');
}

start();
