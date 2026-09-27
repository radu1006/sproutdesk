'use strict';

/**
 * Database facade. Everything in the application talks to the database through
 * this module, which forwards to either the SQLite or the PostgreSQL driver
 * depending on DATABASE_CLIENT in .env.
 *
 * Public API
 *   all(sql, params)  -> array of rows
 *   get(sql, params)  -> first row or null
 *   run(sql, params)  -> { id, changes, row }   (use RETURNING id for inserts)
 *   exec(sql)         -> raw multi-statement DDL
 *   tx(async fn)      -> run fn inside a transaction
 *
 * SQL is always parameterised with `?` placeholders - values are never
 * interpolated into the statement text.
 */

const config = require('../config');

const driver = config.db.client === 'postgres' ? require('./postgres') : require('./sqlite');

module.exports = {
  dialect: driver.dialect,
  connect: (...args) => driver.connect(...args),
  exec: (...args) => driver.exec(...args),
  all: (...args) => driver.all(...args),
  get: (...args) => driver.get(...args),
  run: (...args) => driver.run(...args),
  tx: (...args) => driver.tx(...args),
  health: (...args) => driver.health(...args),
  close: (...args) => driver.close(...args),
};
