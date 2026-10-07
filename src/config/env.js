const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const REQUIRED_VARS = ['DATABASE_URL', 'SESSION_SECRET', 'APP_BASE_URL', 'KEY_ENCRYPTION_KEY'];

function assertRequiredEnv() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = {
  assertRequiredEnv,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  appBaseUrl: process.env.APP_BASE_URL,
  databaseUrl: process.env.DATABASE_URL,
  sessionSecret: process.env.SESSION_SECRET,
  keyEncryptionKey: process.env.KEY_ENCRYPTION_KEY,
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM,
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || '',
  alpacaFallbackKeyId: process.env.ALPACA_FALLBACK_KEY_ID || '',
  alpacaFallbackSecret: process.env.ALPACA_FALLBACK_SECRET || '',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 1000,
  emailDailyCap: Number(process.env.EMAIL_DAILY_CAP) || 50,
};
