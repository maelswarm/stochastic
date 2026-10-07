const express = require('express');
const validator = require('validator');

const usersRepo = require('../db/repositories/users.repo');
const tokensRepo = require('../db/repositories/tokens.repo');
const passwordService = require('../services/password.service');
const tokenService = require('../services/token.service');
const emailService = require('../services/email.service');
const turnstileService = require('../services/turnstile.service');
const requireGuest = require('../middleware/requireGuest');
const { rateLimit } = require('../middleware/rateLimit');
const env = require('../config/env');

const router = express.Router();

// Credential-guessing and email-bombing (activation/reset spam) warrant a
// much tighter cap than general API traffic.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many attempts -- try again in a few minutes.' });

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

async function verifyCaptcha(req) {
  return turnstileService.verify(req.body['cf-turnstile-response'], req.ip);
}

// -- Signup ------------------------------------------------------------

router.get('/signup', requireGuest, (req, res) => {
  res.render('auth/signup', {
    title: 'Sign up',
    errors: [],
    email: '',
    turnstileSiteKey: env.turnstileSiteKey,
  });
});

router.post('/signup', authLimiter, requireGuest, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const { password } = req.body;

  const errors = [];
  if (!validator.isEmail(email)) errors.push('Enter a valid email address.');
  const strength = passwordService.validateStrength(password);
  if (!strength.valid) errors.push(strength.message);

  if (errors.length === 0 && (await usersRepo.findByEmail(email))) {
    errors.push('An account with that email already exists.');
  }
  if (errors.length === 0 && !(await verifyCaptcha(req))) {
    errors.push('CAPTCHA verification failed. Please try again.');
  }

  if (errors.length > 0) {
    return res.status(400).render('auth/signup', {
      title: 'Sign up',
      errors,
      email,
      turnstileSiteKey: env.turnstileSiteKey,
    });
  }

  const passwordHash = await passwordService.hash(password);
  const user = await usersRepo.createUser({ email, passwordHash });

  const rawToken = tokenService.generateRawToken();
  await tokensRepo.issueToken({
    userId: user.id,
    purpose: 'activation',
    tokenHash: tokenService.hashToken(rawToken),
    expiresAt: tokenService.expiryFor('activation'),
  });
  await emailService.sendActivationEmail(user, rawToken);

  res.render('auth/check-email', { title: 'Check your email', email });
});

// -- Email verification --------------------------------------------------

router.get('/verify-email', async (req, res) => {
  const rawToken = req.query.token || '';
  const tokenRow = rawToken ? await tokensRepo.findValid(tokenService.hashToken(rawToken), 'activation') : null;

  if (!tokenRow) {
    return res.status(400).render('auth/verify-invalid', { title: 'Link expired' });
  }

  await usersRepo.activateUser(tokenRow.user_id);
  await tokensRepo.markUsed(tokenRow.id);

  setFlash(req, 'success', 'Your email is verified. You can log in now.');
  res.redirect('/login');
});

router.post('/verify-email/resend', authLimiter, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = await usersRepo.findByEmail(email);

  // Anti-enumeration: always show the same message regardless of match.
  if (user && user.status === 'pending_verification') {
    const rawToken = tokenService.generateRawToken();
    await tokensRepo.issueToken({
      userId: user.id,
      purpose: 'activation',
      tokenHash: tokenService.hashToken(rawToken),
      expiresAt: tokenService.expiryFor('activation'),
    });
    await emailService.sendActivationEmail(user, rawToken);
  }

  res.render('auth/check-email', { title: 'Check your email', email });
});

// -- Login / logout -------------------------------------------------------

router.get('/login', requireGuest, (req, res) => {
  res.render('auth/login', {
    title: 'Log in',
    errors: [],
    email: '',
    next: req.query.next || '',
    turnstileSiteKey: env.turnstileSiteKey,
  });
});

router.post('/login', authLimiter, requireGuest, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  const next = req.body.next || '';

  if (!(await verifyCaptcha(req))) {
    return res.status(400).render('auth/login', {
      title: 'Log in',
      errors: ['CAPTCHA verification failed. Please try again.'],
      email,
      next,
      turnstileSiteKey: env.turnstileSiteKey,
    });
  }

  const user = await usersRepo.findByEmail(email);
  const passwordOk = user && (await passwordService.compare(password, user.password_hash));

  if (!passwordOk) {
    return res.status(400).render('auth/login', {
      title: 'Log in',
      errors: ['Incorrect email or password.'],
      email,
      next,
      turnstileSiteKey: env.turnstileSiteKey,
    });
  }

  if (user.status !== 'active') {
    return res.status(400).render('auth/login', {
      title: 'Log in',
      errors: ['Please verify your email before logging in.'],
      email,
      next,
      showResend: true,
      turnstileSiteKey: env.turnstileSiteKey,
    });
  }

  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = user.id;
    req.session.email = user.email;
    res.redirect(next && next.startsWith('/') ? next : '/dashboard');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('stoch.sid');
    res.redirect('/');
  });
});

// -- Forgot / reset password ----------------------------------------------

router.get('/forgot-password', requireGuest, (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Forgot password',
    sent: false,
    email: '',
    errors: [],
    turnstileSiteKey: env.turnstileSiteKey,
  });
});

router.post('/forgot-password', authLimiter, requireGuest, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();

  if (!(await verifyCaptcha(req))) {
    return res.status(400).render('auth/forgot-password', {
      title: 'Forgot password',
      sent: false,
      email,
      errors: ['CAPTCHA verification failed. Please try again.'],
      turnstileSiteKey: env.turnstileSiteKey,
    });
  }

  const user = await usersRepo.findByEmail(email);

  // Anti-enumeration: always show the same confirmation regardless of match.
  if (user && user.status === 'active') {
    const rawToken = tokenService.generateRawToken();
    await tokensRepo.issueToken({
      userId: user.id,
      purpose: 'password_reset',
      tokenHash: tokenService.hashToken(rawToken),
      expiresAt: tokenService.expiryFor('password_reset'),
    });
    await emailService.sendPasswordResetEmail(user, rawToken);
  }

  res.render('auth/forgot-password', { title: 'Forgot password', sent: true, email });
});

router.get('/reset-password', requireGuest, async (req, res) => {
  const rawToken = req.query.token || '';
  const tokenRow = rawToken
    ? await tokensRepo.findValid(tokenService.hashToken(rawToken), 'password_reset')
    : null;

  if (!tokenRow) {
    return res.status(400).render('auth/reset-invalid', { title: 'Link expired' });
  }

  res.render('auth/reset-password', { title: 'Reset password', errors: [], token: rawToken });
});

router.post('/reset-password', authLimiter, requireGuest, async (req, res) => {
  const rawToken = req.body.token || '';
  const { password } = req.body;

  const tokenRow = rawToken
    ? await tokensRepo.findValid(tokenService.hashToken(rawToken), 'password_reset')
    : null;

  if (!tokenRow) {
    return res.status(400).render('auth/reset-invalid', { title: 'Link expired' });
  }

  const strength = passwordService.validateStrength(password);
  if (!strength.valid) {
    return res.status(400).render('auth/reset-password', {
      title: 'Reset password',
      errors: [strength.message],
      token: rawToken,
    });
  }

  const passwordHash = await passwordService.hash(password);
  await usersRepo.updatePassword(tokenRow.user_id, passwordHash);
  await tokensRepo.markUsed(tokenRow.id);

  setFlash(req, 'success', 'Your password has been reset. You can log in now.');
  res.redirect('/login');
});

module.exports = router;
