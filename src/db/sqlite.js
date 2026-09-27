'use strict';

/**
 * SQLite driver (default). Uses `better-sqlite3`, which is synchronous - the
 * async wrapper below keeps the public interface identical to the PostgreSQL
 * driver so that the rest of the application never has to care.
 *
 * The database is a single file on disk: no server to install, no service to
 * run, no credentials to create. See docs/DATABASE.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

function connect() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.db.sqliteFile), { recursive: true });
  db = new Database(config.db.sqliteFile);
  db.pragma('journal_mode = WAL'); // safer + faster concurrent reads
  db.pragma('foreign_keys = ON'); // enforce REFERENCES clauses
  db.pragma('busy_timeout = 5000');
  return db;
}

function coerce(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

async function exec(sql) {
  connect().exec(sql);
}

async function all(sql, params = []) {
  return connect().prepare(sql).all(...params.map(coerce));
}

async function get(sql, params = []) {
  const row = connect().prepare(sql).get(...params.map(coerce));
  return row === undefined ? null : row;
}

async function run(sql, params = []) {
  const database = connect();
  const stmt = database.prepare(sql);
  if (stmt.reader) {
    // Statement with a RETURNING clause: fetch the row, then read the change count.
    const row = stmt.get(...params.map(coerce)) || null;
    const changes = database.prepare('SELECT changes() AS c').get().c;
    return { id: row && row.id !== undefined ? Number(row.id) : null, changes, row };
  }
  const info = stmt.run(...params.map(coerce));
  return {
    id: Number(info.lastInsertRowid) || null,
    changes: info.changes,
    row: null,
  };
}

/**
 * Run `fn` inside a transaction. Explicit BEGIN/COMMIT (instead of
 * better-sqlite3's .transaction()) so that async callbacks behave the same way
 * they do on PostgreSQL. Nested transactions are not supported.
 */
async function tx(fn) {
  const database = connect();
  database.exec('BEGIN');
  try {
    const result = await fn();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* the transaction was already rolled back by SQLite */
    }
    throw error;
  }
}

async function health() {
  const row = await get('SELECT 1 AS ok');
  return { client: 'sqlite', ok: row?.ok === 1, file: config.db.sqliteFile };
}

async function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { dialect: 'sqlite', connect, exec, all, get, run, tx, health, close };
