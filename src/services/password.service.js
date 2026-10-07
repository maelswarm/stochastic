const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;
const MIN_LENGTH = 10;

async function hash(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function compare(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

// Modern NIST 800-63B-style guidance: enforce a minimum length, skip
// composition rules (no forced digits/symbols) which push users toward
// predictable substitutions without improving actual entropy.
function validateStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return { valid: false, message: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  return { valid: true };
}

module.exports = { hash, compare, validateStrength };
