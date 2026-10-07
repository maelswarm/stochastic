// Bootstraps a fresh Postgres server for stochastic: if the app's own
// DATABASE_URL role/database don't exist yet, creates them via a separate
// admin connection, then runs all pending migrations (src/db/migrate.js).
// Safe to re-run on an already-set-up server -- it just runs migrations.
require('../src/config/env').assertRequiredEnv();
const { Client } = require('pg');
const { execFileSync } = require('child_process');
const path = require('path');

function parseDatabaseUrl(url) {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password || ''),
    host: u.hostname,
    port: u.port || 5432,
    database: u.pathname.replace(/^\//, ''),
  };
}

function escapeSqlLiteral(value) {
  return value.replace(/'/g, "''");
}

async function canConnectAsApp(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch (err) {
    return false;
  }
}

async function ensureRoleAndDatabase(appConn) {
  const adminUrl = process.env.POSTGRES_ADMIN_URL
    || `postgres://postgres@${appConn.host}:${appConn.port}/postgres`;

  const admin = new Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `stochastic's database/role don't exist yet, and connecting as an admin to create them failed ` +
      `(tried ${adminUrl}).\nSet POSTGRES_ADMIN_URL to a working superuser connection string ` +
      `(e.g. postgres://postgres:<password>@localhost:5432/postgres) and re-run "npm run db:setup".\n` +
      `Underlying error: ${err.message}`
    );
  }

  try {
    const { rows: roleRows } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appConn.user]);
    if (roleRows.length === 0) {
      console.log(`Creating role "${appConn.user}"...`);
      await admin.query(`CREATE ROLE "${appConn.user}" LOGIN PASSWORD '${escapeSqlLiteral(appConn.password)}'`);
    } else {
      console.log(`Role "${appConn.user}" already exists.`);
    }

    const { rows: dbRows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [appConn.database]);
    if (dbRows.length === 0) {
      console.log(`Creating database "${appConn.database}" (owner: ${appConn.user})...`);
      await admin.query(`CREATE DATABASE "${appConn.database}" OWNER "${appConn.user}"`);
    } else {
      console.log(`Database "${appConn.database}" already exists.`);
    }
  } finally {
    await admin.end();
  }
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  const appConn = parseDatabaseUrl(databaseUrl);

  if (await canConnectAsApp(databaseUrl)) {
    console.log(`Connected to "${appConn.database}" as "${appConn.user}" -- role/database already set up.`);
  } else {
    console.log('Could not connect as the app role; attempting to create it...');
    await ensureRoleAndDatabase(appConn);
  }

  console.log('Running migrations...');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'db', 'migrate.js')], { stdio: 'inherit' });
  console.log('Database setup complete.');
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
