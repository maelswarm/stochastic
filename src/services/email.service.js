const { Resend } = require('resend');
const env = require('../config/env');

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

async function send({ to, subject, html }) {
  if (!resend) {
    // No RESEND_API_KEY configured yet (local dev) -- log instead of sending
    // so the auth flow is still fully testable end-to-end without an account.
    console.log(`\n[email:dev-mode] To: ${to}\nSubject: ${subject}\n${html}\n`);
    return;
  }
  await resend.emails.send({ from: env.emailFrom, to, subject, html });
}

async function sendActivationEmail(user, rawToken) {
  const link = `${env.appBaseUrl}/verify-email?token=${rawToken}`;
  await send({
    to: user.email,
    subject: 'Confirm your stochastic account',
    html: `
      <p>Welcome to stochastic. Confirm your email to finish creating your account:</p>
      <p><a href="${link}">${link}</a></p>
      <p>This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>
    `,
  });
}

async function sendPasswordResetEmail(user, rawToken) {
  const link = `${env.appBaseUrl}/reset-password?token=${rawToken}`;
  await send({
    to: user.email,
    subject: 'Reset your stochastic password',
    html: `
      <p>We received a request to reset your stochastic password.</p>
      <p><a href="${link}">${link}</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
    `,
  });
}

async function sendSignalAlertEmail(user, { symbol, signalName, timeframe, triggeredAt, details, ruleId, instrumentId }) {
  const chartLink = `${env.appBaseUrl}/dashboard?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}`;
  const pauseLink = `${env.appBaseUrl}/api/alerts/${ruleId}/pause?token=${rawPauseToken(user, ruleId)}`;
  await send({
    to: user.email,
    subject: `⚡ ${symbol} ${timeframe}: ${signalName} detected`,
    html: `
      <p><strong>${symbol}</strong> (${timeframe}) triggered <strong>${signalName}</strong> at ${new Date(triggeredAt).toUTCString()}.</p>
      ${details ? `<pre style="background:#f4f4f5;padding:8px 12px;border-radius:6px;">${escapeHtml(JSON.stringify(details, null, 2))}</pre>` : ''}
      <p><a href="${chartLink}">View on the dashboard</a></p>
      <p style="color:#888;font-size:12px;">Don't want this alert anymore? <a href="${pauseLink}">Pause this rule</a>.</p>
    `,
  });
}

async function sendDigestEmail(user, events) {
  const items = events
    .map((e) => `<li><strong>${e.symbol}</strong> (${e.timeframe}) &mdash; ${e.signalName} at ${new Date(e.triggeredAt).toUTCString()}</li>`)
    .join('');
  await send({
    to: user.email,
    subject: `stochastic daily digest: ${events.length} signal${events.length === 1 ? '' : 's'}`,
    html: `<p>Signals detected in the last 24 hours:</p><ul>${items}</ul><p><a href="${env.appBaseUrl}/dashboard">Open dashboard</a></p>`,
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// One-click pause links don't need to survive a server restart or be
// independently revocable, so a stable HMAC over (user, rule) is enough --
// no dedicated token table like the activation/reset flows need.
function rawPauseToken(user, ruleId) {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', env.sessionSecret).update(`${user.id}:${ruleId}`).digest('hex').slice(0, 32);
}

module.exports = {
  sendActivationEmail,
  sendPasswordResetEmail,
  sendSignalAlertEmail,
  sendDigestEmail,
  verifyPauseToken(userId, ruleId, token) {
    return rawPauseToken({ id: userId }, ruleId) === token;
  },
};
