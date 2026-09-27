'use strict';

/**
 * Tiny SQL builders. Column names come from a whitelist in the calling route
 * (never from the request), values are always bound as parameters.
 */

/** Convert JS values to what the drivers expect (booleans -> 0/1). */
function normalise(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Only keys whose value is not `undefined` take part in the statement. */
function definedKeys(data) {
  return Object.keys(data).filter((key) => data[key] !== undefined);
}

function buildInsert(table, data) {
  const columns = definedKeys(data);
  const sql =
    `INSERT INTO ${table} (${columns.join(', ')}) ` +
    `VALUES (${columns.map(() => '?').join(', ')}) RETURNING id`;
  return { sql, params: columns.map((column) => normalise(data[column])) };
}

function buildUpdate(table, data, whereSql, whereParams = []) {
  const columns = definedKeys(data);
  if (columns.length === 0) return null;
  const sql =
    `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} ` +
    `WHERE ${whereSql}`;
  return { sql, params: [...columns.map((column) => normalise(data[column])), ...whereParams] };
}

module.exports = { buildInsert, buildUpdate, normalise };
