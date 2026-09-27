'use strict';

/**
 * PostgreSQL driver. Same interface as the SQLite driver, so switching
 * database engines is a one-line change in .env (DATABASE_CLIENT=postgres).
 *
 * SQL text is written once, with `?` placeholders, and translated to the
 * PostgreSQL `$1, $2, ...` form here.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = require('pg');
const config = require('../config');

/** Holds the dedicated client of the currently running transaction (if any). */
const txStore = new AsyncLocalStorage();
let pool = null;

function connect() {
  if (pool) return pool;
  const ssl = config.db.ssl ? { rejectUnauthorized: false } : undefined;
  pool = config.db.url
    ? new Pool({ connectionString: config.db.url, ssl })
    : new Pool({
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        ssl,
      });
  pool.on('error', (error) => {
    console.error('[db] idle PostgreSQL client error:', error.message);
  });
  return pool;
}

/** The transaction client when inside tx(), otherwise the pool. */
function executor() {
  return txStore.getStore() || connect();
}

/** `SELECT * FROM t WHERE a = ? AND b = ?` -> `... a = $1 AND b = $2` */
function toPgSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function exec(sql) {
  await connect().query(sql);
}

async function all(sql, params = []) {
  const result = await executor().query(toPgSql(sql), params);
  return result.rows;
}

async function get(sql, params = []) {
  const result = await executor().query(toPgSql(sql), params);
  return result.rows[0] ?? null;
}

async function run(sql, params = []) {
  const result = await executor().query(toPgSql(sql), params);
  const row = result.rows[0] ?? null;
  return {
    id: row && row.id !== undefined && row.id !== null ? Number(row.id) : null,
    changes: result.rowCount ?? 0,
    row,
  };
}

async function tx(fn) {
  const client = await connect().connect();
  try {
    await client.query('BEGIN');
    const result = await txStore.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already gone */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function health() {
  const result = await connect().query('SELECT 1 AS ok');
  return {
    client: 'postgres',
    ok: result.rows[0]?.ok === 1,
    database: config.db.url ? '(from DATABASE_URL)' : config.db.database,
  };
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { dialect: 'postgres', connect, exec, all, get, run, tx, health, close };
