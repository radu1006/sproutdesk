'use strict';

/**
 * Creates (or with --fresh recreates) the database schema.
 *
 *   node src/db/migrate.js            -> create missing tables/indexes
 *   node src/db/migrate.js --fresh    -> drop everything first (DESTRUCTIVE)
 *
 * The schema is engine specific: src/db/schema.sqlite.sql or
 * src/db/schema.postgres.sql, chosen by DATABASE_CLIENT in .env.
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const db = require('../db');
const { nowIso } = require('../lib/dates');

/** Child tables first, so that foreign keys never block the drop. */
const TABLES_IN_DROP_ORDER = [
  'announcement_reads',
  'payments',
  'messages',
  'invoices',
  'daily_reports',
  'observations',
  'attendance',
  'class_posts',
  'announcements',
  'events',
  'guardians',
  'children',
  'classrooms',
  'sessions',
  'users',
  'settings',
];

const DEFAULT_SETTINGS = {
  school_name: 'Little Acorns Early Learning Centre',
  school_tagline: 'Every day, something new to discover',
  school_address: '12 Orchard Lane, Springfield',
  school_phone: '+1 555 0100',
  school_email: 'hello@littleacorns.test',
  timezone: 'UTC',
  currency: 'USD',
  default_due_day: '5',
};

function schemaPath() {
  const file = config.db.client === 'postgres' ? 'schema.postgres.sql' : 'schema.sqlite.sql';
  return path.join(__dirname, file);
}

async function dropAll() {
  const suffix = db.dialect === 'postgres' ? ' CASCADE' : '';
  for (const table of TABLES_IN_DROP_ORDER) {
    await db.exec(`DROP TABLE IF EXISTS ${table}${suffix}`);
  }
}

async function applySchema() {
  const file = schemaPath();
  const sql = fs.readFileSync(file, 'utf8');
  await db.exec(sql);
  return path.basename(file);
}

async function applyDefaultSettings() {
  const inserted = [];
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const result = await db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO NOTHING`,
      [key, String(value)],
    );
    if (result.changes > 0) inserted.push(key);
  }
  return inserted;
}

async function tableCounts() {
  const counts = {};
  for (const table of [...TABLES_IN_DROP_ORDER].reverse()) {
    const row = await db.get(`SELECT COUNT(*) AS total FROM ${table}`);
    counts[table] = Number(row?.total ?? 0);
  }
  return counts;
}

async function migrate({ fresh = false, quiet = false } = {}) {
  if (fresh) await dropAll();
  const applied = await applySchema();
  const settings = await applyDefaultSettings();
  if (!quiet) {
    console.log(`SproutDesk: schema applied from ${applied} (engine: ${db.dialect})`);
    if (settings.length) console.log(`SproutDesk: default settings seeded (${settings.length})`);
  }
  return { applied, settings };
}

async function main() {
  const fresh = process.argv.includes('--fresh');
  if (fresh) {
    console.log('SproutDesk: --fresh requested, dropping all tables...');
  }
  await migrate({ fresh });

  const counts = await tableCounts();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  console.log(`SproutDesk: database ready, ${total} row(s) in total.`);
  if (db.dialect === 'sqlite') {
    console.log(`SproutDesk: SQLite file -> ${config.db.sqliteFile}`);
  } else {
    console.log(`SproutDesk: PostgreSQL -> ${config.db.url || `${config.db.host}:${config.db.port}/${config.db.database}`}`);
  }
  console.log(`SproutDesk: finished at ${nowIso()}`);
  await db.close();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('Migration failed:', error.message);
    try {
      await db.close();
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  });
}

module.exports = { migrate, dropAll, applySchema, applyDefaultSettings, tableCounts, DEFAULT_SETTINGS };
