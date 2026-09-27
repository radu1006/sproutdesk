'use strict';

/**
 * SproutDesk HTTP server.
 *
 *   node server.js          # production-ish
 *   npm run dev             # restarts on file changes (node --watch)
 *
 * Static single page app lives in public/, uploaded images in uploads/.
 * The API is mounted under /api by src/routes/index.js.
 */

// .env must be read before config.js is required.
require('dotenv').config();

const path = require('node:path');
const express = require('express');
const config = require('./src/config');
const db = require('./src/db');
const sessions = require('./src/lib/sessions');
const { attachUser } = require('./src/middleware/auth');
const { apiNotFound, errorHandler } = require('./src/middleware/error');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Behind a reverse proxy the real client IP is in X-Forwarded-For.
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Minimal request log: method, path, status, duration.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`,
      );
    });
    next();
  });

  // Uploaded feed images. `dotfiles: 'deny'` keeps hidden files out of reach.
  app.use(
    config.uploads.publicPrefix,
    express.static(config.uploads.dir, { dotfiles: 'deny', maxAge: '7d', index: false }),
  );

  // Serves public/index.html, public/app.js, public/styles.css ...
  app.use(express.static(path.join(config.rootDir, 'public'), { extensions: ['html'] }));

  // Makes req.user available to every route that needs it.
  app.use(attachUser);

  app.use('/api', require('./src/routes'));

  // Unknown /api/* routes get a JSON 404 instead of the HTML shell.
  app.use(apiNotFound);

  // Single page app fallback: any other GET returns the shell.
  app.get('*', (req, res, next) => {
    res.sendFile(path.join(config.rootDir, 'public', 'index.html'), (error) => {
      if (error) next(error);
    });
  });

  app.use(errorHandler);

  return app;
}

/** Fails with a readable message when `npm run migrate` has not been run yet. */
async function verifyDatabase() {
  try {
    await db.get('SELECT COUNT(*) AS total FROM settings');
    return true;
  } catch (error) {
    console.error('SproutDesk: the database is not ready yet.');
    console.error(`  engine: ${db.dialect}`);
    if (db.dialect === 'sqlite') console.error(`  file:   ${config.db.sqliteFile}`);
    console.error(`  reason: ${error.message}`);
    console.error('  Run "npm run migrate" (and optionally "npm run seed") first.');
    return false;
  }
}

function banner() {
  const where = db.dialect === 'sqlite' ? config.db.sqliteFile : config.db.database;
  console.log('');
  console.log(`  SproutDesk ${config.isProduction ? '' : '(development)'}`.trim());
  console.log(`  URL      http://localhost:${config.port}`);
  console.log(`  Health   http://localhost:${config.port}/api/health`);
  console.log(`  Engine   ${db.dialect}${where ? ` (${where})` : ''}`);
  console.log(`  Uploads  ${config.uploads.dir}`);
  console.log('');
}

async function start() {
  const app = createApp();

  if (!(await verifyDatabase())) {
    process.exitCode = 1;
    return null;
  }

  const server = app.listen(config.port, banner);

  // Housekeeping: drop expired sessions once an hour (does not keep Node alive).
  const housekeeping = setInterval(() => {
    sessions.purgeExpired().catch((error) => console.error('[sessions]', error.message));
  }, 60 * 60 * 1000);
  housekeeping.unref();

  const shutdown = (signal) => {
    console.log(`\nSproutDesk: ${signal} received, shutting down.`);
    clearInterval(housekeeping);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error('SproutDesk failed to start:', error);
    process.exit(1);
  });
}

module.exports = { createApp, start, verifyDatabase };
