'use strict';

/**
 * Central configuration. Every value can be overridden through the environment
 * (a `.env` file is loaded in server.js / migrate.js / seed.js before this file
 * is required).
 */

const path = require('node:path');

function str(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : String(value);
}

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.join(config.rootDir, p);
}

const config = {
  rootDir: path.resolve(__dirname, '..'),
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 3000),
  session: {
    cookieName: 'sproutdesk_session',
    secret: str('SESSION_SECRET', 'dev-only-insecure-secret'),
    ttlHours: int('SESSION_TTL_HOURS', 12),
  },
  db: {
    // 'sqlite' (default, zero install) or 'postgres'
    client: str('DATABASE_CLIENT', 'sqlite').toLowerCase(),
    sqlitePath: str('SQLITE_PATH', './data/sproutdesk.sqlite'),
    url: str('DATABASE_URL', ''),
    host: str('PGHOST', 'localhost'),
    port: int('PGPORT', 5432),
    database: str('PGDATABASE', 'sproutdesk'),
    user: str('PGUSER', 'sproutdesk'),
    password: str('PGPASSWORD', 'sproutdesk'),
    ssl: str('PGSSL', 'false') === 'true',
  },
  uploads: {
    dir: str('UPLOAD_DIR', './uploads'),
    maxBytes: int('MAX_UPLOAD_MB', 5) * 1024 * 1024,
    publicPrefix: '/uploads',
  },
  locale: {
    // Display defaults; the school name/currency can be changed in Settings.
    currency: str('DEFAULT_CURRENCY', 'USD'),
    timeZone: str('TZ', 'UTC'),
    dateFormat: 'YYYY-MM-DD',
  },
  seed: {
    adminEmail: str('SEED_ADMIN_EMAIL', 'admin@sproutdesk.test'),
    adminPassword: str('SEED_ADMIN_PASSWORD', 'Admin123!'),
  },
};

config.isProduction = config.env === 'production';
config.db.sqliteFile = resolveFromRoot(config.db.sqlitePath);
config.uploads.dir = resolveFromRoot(config.uploads.dir);

module.exports = config;
module.exports.resolveFromRoot = resolveFromRoot;
