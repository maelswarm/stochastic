const express = require('express');
const path = require('path');
const helmet = require('helmet');
const session = require('express-session');
const pgSessionFactory = require('connect-pg-simple');
const pool = require('./db/pool');
const env = require('./config/env');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { rateLimit } = require('./middleware/rateLimit');

const pgSession = pgSessionFactory(session);
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// helmet's default CSP locks script-src to 'self' (good) and leaves
// connect-src/frame-src falling back to default-src 'self' -- both need
// widening for the Cloudflare Turnstile widget (its own script, the
// challenge iframe it renders, and the calls it makes). Everything else
// (chart, widgets, ws) is same-origin or vendored, so no other origins
// need adding.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", 'https://challenges.cloudflare.com'],
        'frame-src': ["'self'", 'https://challenges.cloudflare.com'],
        'connect-src': ["'self'", 'https://challenges.cloudflare.com'],
      },
    },
  })
);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
    name: 'stoch.sid',
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, email: req.session.email }
    : null;
  res.locals.canonicalUrl = env.appBaseUrl + req.originalUrl;
  next();
});

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'unreachable' });
  }
});

// Broad API guard against runaway clients/scripts; auth routes get their
// own stricter limiter (see auth.routes.js) since credential-guessing and
// email-bombing warrant a much tighter cap than normal dashboard polling.
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 180, message: 'Too many requests -- slow down.' }));

app.use('/', routes);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.status(404).render('errors/404');
});

app.use(errorHandler);

module.exports = app;
