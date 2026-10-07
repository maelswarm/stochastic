// AES-256-GCM encryption for BYOK provider keys. Encrypted blobs are stored
// as `${iv}:${authTag}:${ciphertext}` (all base64) in user_api_keys -- never
// logged, only decrypted transiently inside an adapter call.
const crypto = require('crypto');
const env = require('../../config/env');

function loadMasterKey() {
  const raw = env.keyEncryptionKey;
  if (!raw) throw new Error('KEY_ENCRYPTION_KEY is not set.');
  // Accept base64 (preferred, what .env.example generates) or hex.
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('KEY_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return buf;
}

function encrypt(plaintext) {
  const key = loadMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function decrypt(payload) {
  const key = loadMasterKey();
  const [ivB64, tagB64, ctB64] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

function last4(secret) {
  return secret.slice(-4);
}

module.exports = { encrypt, decrypt, last4 };
