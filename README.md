# stochastic

**Signals, not noise.** A self-hosted market dashboard for US stocks with live charts, locally computed metrics, 40 deterministic and stochastic signal detectors, and email alerts that fire on bar close.

Each user brings their own free [Alpaca](https://alpaca.markets) API key. The app has no shared data subscription. Users' keys are encrypted at rest, and every indicator, metric and signal is computed from cached OHLCV candles, so the provider only ever supplies raw bars.

## Features

- **Modular dashboard.** Drag-and-resize widget grid with a per-user saved layout. Widgets don't call each other; they communicate only through a pub/sub data bus, so they can be added or removed independently.
  - **Chart:** candlesticks plus volume ([Lightweight Charts](https://github.com/tradingview/lightweight-charts)), timeframes 1m / 5m / 15m / 1h / 4h / 1D / 1W, and a live 1-second poll of the focused symbol.
  - **Metrics grid:** about 40 stats computed from daily bars (see [Metrics](#metrics)).
  - **Signal feed** and **My Alerts** (create, edit and delete alert rules).
  - **Watchlist** and symbol search covering every tradable NYSE/NASDAQ stock.
  - **Orderbook:** top-of-book bid/ask from Alpaca's IEX feed.
- **Signal engine.** 27 deterministic and 13 stochastic/statistical detectors. Each one is a pure function over closed candles with a parameter schema (see [Signal catalog](#signal-catalog)).
- **Alerts.** A rule fires only on bar close (no intra-bar repaints) and only once per rule per bar. Each rule has its own email cooldown, and each user has a daily email cap. Users can choose instant emails or a daily digest. Every email has a one-click "pause this rule" link, and in-app notifications are pushed over WebSocket.
- **Bring your own key.** Alpaca keys are encrypted with AES-256-GCM, shown only by their last 4 characters, and can be tested and revoked from Settings.
- **Rate-limit aware.** Each key's request budget is split into two independently paced lanes: `live` for the on-screen chart and `alerts` for background rule checks, each capped at about 60 requests/min. A 190/min sliding-window backstop keeps every key under Alpaca's free-tier limit of 200/min.
- **Shared candle cache.** Candles are stored in Postgres and shared by all users. Once any user's key has fetched AAPL 1D, every other user reads it from the cache for free.
- **Full account flows.** Sign up, email verification, login and password reset, with Cloudflare Turnstile bot protection and rate-limited auth routes.
- Light and dark themes, no frontend build step.

> **Scope:** stocks only. Adapters for crypto (Binance), commodities (Twelve Data) and futures (Yahoo) are still in `src/services/marketdata/`, but none of them is connected to the app. The Trade Tape widget is a placeholder until a streaming feed is added. See the status note at the top of [PLAN.md](PLAN.md).

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ (CommonJS) |
| Server | Express 5, helmet, EJS server-rendered views |
| Frontend | Vanilla JS (ES modules) and CSS, no build step |
| Charting | TradingView Lightweight Charts, vendored in `public/vendor/` |
| Database | PostgreSQL via `pg`, raw SQL migrations |
| Sessions / auth | `express-session` + `connect-pg-simple`, `bcryptjs` |
| Realtime | `ws`, a topic-based hub authenticated by the session cookie |
| Email | [Resend](https://resend.com) (logs emails to the console when no key is set) |
| Bot protection | Cloudflare Turnstile (skipped when no key is set) |

## Getting started

### Prerequisites

- Node.js **20 or newer**
- PostgreSQL (any recent version; developed against 18)
- A free Alpaca account for an API key. A paper-trading account works and needs no funding.
- *Optional:* `openssl` on your `PATH`, used only to generate a self-signed dev certificate when you run in HTTPS mode

### 1. Install

```bash
git clone https://github.com/maelswarm/stochastic.git
cd stochastic
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Fill in at least the [required variables](#configuration). Generate `KEY_ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> Keep `KEY_ENCRYPTION_KEY` stable and backed up. If it changes, every stored user API key becomes unreadable.

### 3. Set up the database

```bash
npm run db:setup
```

This creates the role and database named in `DATABASE_URL` if they don't exist yet, then runs all migrations. Creating the role and database needs a superuser connection. The script tries `postgres://postgres@<host>:<port>/postgres` by default; if that doesn't work, set `POSTGRES_ADMIN_URL`:

```bash
POSTGRES_ADMIN_URL=postgres://postgres:<password>@localhost:5432/postgres npm run db:setup
```

If the role and database already exist, you can run migrations alone with `npm run migrate`.

### 4. Run

```bash
npm run dev      # nodemon, restarts on changes
# or
npm start
```

With `PORT=3000` (the default in `.env.example`) the server runs in plain HTTP on a single port. Open http://localhost:3000.

### 5. First-run checklist

1. **Sign up.** Without `RESEND_API_KEY`, the verification email is printed to the server console. Open the link from there.
2. **Connect your Alpaca key** in **Settings** and click **Test key**.
3. **Load the stock catalog:**
   ```bash
   npm run seed:instruments
   ```
   The instrument list is pulled from Alpaca's `/v2/assets`. The app has no operator key, so the sync uses a key that a user has already connected. That's why the catalog stays empty until step 2 is done. After this first run, the sync repeats automatically every day at 00:05 server time.
4. Open the dashboard, search for a symbol and add it to your watchlist.

> Metrics need at least 20 daily bars. Keep a symbol open for a moment while its history is fetched and cached.

## Configuration

All configuration is read from environment variables (`.env` is loaded with `dotenv`).

| Variable | Required | Description |
|---|:---:|---|
| `DATABASE_URL` | ✓ | Postgres connection string for the app role |
| `SESSION_SECRET` | ✓ | Long random string that signs session cookies and alert pause links |
| `APP_BASE_URL` | ✓ | Public base URL, used in email links, the canonical URL and the sitemap |
| `KEY_ENCRYPTION_KEY` | ✓ | 32-byte key (base64 or hex) that encrypts users' API keys at rest |
| `RESEND_API_KEY` | | Resend API key. If blank, emails are logged to the console |
| `EMAIL_FROM` | | Sender address, e.g. `stochastic <alerts@yourdomain.com>` |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | | Cloudflare Turnstile keys. If blank, the CAPTCHA is skipped |
| `POLL_INTERVAL_MS` | | Pacing of each budget lane (default `1000`) |
| `EMAIL_DAILY_CAP` | | Maximum alert emails per user per day (default `50`) |
| `NODE_ENV` | | Set to `production` to mark session cookies `Secure` |
| `POSTGRES_ADMIN_URL` | | Superuser connection used only by `npm run db:setup` |

### Server and TLS

| Variable | Description |
|---|---|
| `PORT` | If set (and `HTTPS_PORT` is not), serves plain HTTP on this one port. This is the dev mode. |
| `HTTPS_PORT` / `HTTP_PORT` | HTTPS mode ports. Defaults are `443` and `80`; HTTP redirects to HTTPS. |
| `HOST` | Bind address (default `0.0.0.0`) |
| `DOMAIN` | Domain used to find Let's Encrypt certificates at `/etc/letsencrypt/live/<DOMAIN>/` |
| `TLS_CERT` / `TLS_KEY` | Explicit certificate and key paths, overriding the Let's Encrypt lookup |

## Deployment

For production, **unset `PORT`** so the server starts in HTTPS mode:

- HTTPS on `HTTPS_PORT` (default 443), plus a plain-HTTP listener on `HTTP_PORT` (default 80) that 301-redirects to HTTPS.
- Certificates come from `TLS_CERT`/`TLS_KEY` if set. Otherwise the server uses the Let's Encrypt certificates at `/etc/letsencrypt/live/$DOMAIN/`. If neither exists, it generates a self-signed certificate into `./certs/` (dev only).
- Ports 80 and 443 are privileged. Run with the needed capability (e.g. `setcap cap_net_bind_service`), or use high ports behind a reverse proxy.
- Set `NODE_ENV=production`, a real `APP_BASE_URL`, and the Resend and Turnstile keys.

`GET /healthz` returns `{"status":"ok","db":"ok"}` when the app can reach Postgres.

The app runs as **a single process**. Request budgets and the scheduler state are held in memory, so don't run multiple instances against the same database.

## How it works

```
 Alpaca (each user's key)
        │   paced by budget.service, with "live" and "alerts" lanes per key
        ▼
 cache.service ──► candles table (Postgres, shared by all users)
        │
        ├──► metrics.service   ── computed from 1D bars ─► Metrics widget
        │
        └──► alerts/scheduler  ── on each new closed bar ─► signals/engine (catalog.js)
                                                              │
                                                              ▼
                                  alerts/dispatcher ─► alert_events + notifications
                                                     ─► WebSocket push (realtime.js)
                                                     ─► email via Resend (cooldown + daily cap)
```

- **Live lane:** the focused chart polls its symbol once per second. If the budget slot is busy, the poll is served from the cache rather than queued.
- **Alerts lane:** every 250 ms the scheduler builds the set of `(user, instrument, timeframe)` combinations that have an active alert rule. It refreshes them round-robin within each key's 1/sec allowance.
- **Evaluation is separate from fetching.** A rule is evaluated whenever its cached series gains a new closed bar, whether that bar came from the scheduler or from someone's live chart poll.
- **Dashboard widgets** (`public/js/dashboard/modules/*.js`) register themselves with `registerWidget({ id, title, defaultSize, mount })`. Each one subscribes to bus topics such as `symbol:changed` instead of fetching data directly.

## Signal catalog

<details>
<summary><b>Deterministic (27)</b>: crossovers, thresholds, breakouts, candle patterns</summary>

| Group | Signals |
|---|---|
| Moving averages | Golden cross, death cross, price/SMA cross |
| MACD | Signal-line cross, zero-line cross |
| RSI | Overbought/oversold, 50-midline cross |
| Bands and channels | Bollinger band touch/break, Bollinger squeeze release, Donchian breakout |
| Trend systems | Parabolic SAR flip, Supertrend flip, Ichimoku Tenkan/Kijun cross, Ichimoku cloud breakout, ADX/DMI ±DI cross |
| Oscillators | CCI ±100 cross, ROC zero cross, Awesome Oscillator zero cross |
| Volume | Volume spike, OBV breakout, Chaikin Money Flow sign flip, MFI overbought/oversold, VWAP cross |
| Price action | 52-week high/low break, gap up/down, bullish engulfing, bearish engulfing |

</details>

<details>
<summary><b>Stochastic (13)</b>: oscillator family and statistical/stochastic-process models</summary>

| Group | Signals |
|---|---|
| Stochastic oscillators | %K/%D cross, overbought/oversold, Stochastic RSI cross, Williams %R cross |
| Mean reversion | Z-score extreme, mean-reversion regime (Ornstein-Uhlenbeck half-life) |
| Regimes | Hurst exponent regime shift, volatility regime expansion, ATR spike, ADF stationarity flip |
| Models | Kalman filter trend flip, Monte Carlo touch probability (GBM), correlation breakdown vs SPY |

</details>

Signals are defined in [`src/services/signals/catalog.js`](src/services/signals/catalog.js). The alert-rule UI is generated from each signal's parameter schema, so adding a signal is a single catalog entry.

## Metrics

All metrics are computed on the daily series, whatever timeframe the chart is showing:

- **Price and returns:** last price, day change, 1W/1M/3M/6M/YTD/1Y returns, CAGR, gap %
- **Volatility and risk:** realized volatility (20d/60d), Parkinson and Garman-Klass volatility, ATR and ATR%, max and current drawdown, downside deviation, historical VaR(95), beta and correlation vs SPY
- **Risk-adjusted:** Sharpe, Sortino, Calmar
- **Trend and momentum:** RSI(14), Stochastic %K/%D, MACD histogram, ADX, distance from 52-week high/low, % vs SMA50/SMA200, SMA200 slope
- **Volume and liquidity:** 20-day average volume, relative volume, dollar volume, VWAP deviation
- **Statistical:** 20d/60d z-score, skewness, kurtosis, Hurst exponent, OU half-life, lag-1 autocorrelation

## Project structure

```
src/
  server.js              entrypoint: HTTP/HTTPS, WebSocket, schedulers
  app.js                 Express wiring (helmet CSP, sessions, rate limits, routes)
  realtime.js            WebSocket hub (topic subscriptions, session-cookie auth)
  config/env.js          environment loading and validation
  db/                    pool, migration runner, migrations/*.sql, repositories/
  routes/                auth, dashboard, and /api/* (symbols, candles, metrics,
                         signals, alerts, orderbook, settings)
  services/
    marketdata/          Alpaca adapter, candle cache, budgeter, BYOK keys, instrument sync
    indicators/          pure indicator and statistics functions (unit-tested)
    signals/             signal catalog and evaluation engine
    alerts/              poll scheduler and notification dispatcher
  views/                 EJS templates
public/
  js/dashboard/          grid, data bus, widget registry, modules/*
  css/, vendor/
scripts/                 setup-db.js, seed-instruments.js
test/                    indicator and signal tests (node:test)
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with nodemon |
| `npm run db:setup` | Create the role and database if needed, then migrate |
| `npm run migrate` | Run pending SQL migrations |
| `npm run seed:instruments` | Sync the NYSE/NASDAQ stock catalog from Alpaca |
| `npm test` | Run the unit tests with Node's built-in test runner |

## Testing

```bash
npm test
```

The tests use Node's built-in `node:test` runner and need no database or network. They check the indicator library against known values and edge cases (e.g. a flat price series, near-zero standard deviation) and fire representative signals on synthetic candle series.

## Disclaimer

stochastic is a charting and analysis tool, **not investment advice**. Signals are mechanical pattern detections on market data that may be delayed, incomplete or wrong. Alpaca's free tier serves the IEX feed, which covers only part of total US market volume. Use it at your own risk.

## License

[MIT](LICENSE) © maelswarm

The vendored [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts) library in `public/vendor/` is licensed separately under the Apache License 2.0. Its license header is kept in the file.
