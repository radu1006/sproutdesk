'use strict';

/** Small helpers shared by all route modules. */

const { ApiError, notFound } = require('./errors');

/**
 * Express 4 does not forward rejected promises to the error middleware, so
 * every async route handler is wrapped in this.
 */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** Parses a `?date=` style query parameter, falling back to a default. */
function queryString(query, key, fallback = null) {
  const value = query?.[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function requireRow(row, message = 'Not found.') {
  if (!row) throw notFound(message);
  return row;
}

/** Number of rows requested by the client, clamped to a safe range. */
function limitParam(query, { fallback = 50, max = 200 } = {}) {
  const raw = Number.parseInt(query?.limit ?? '', 10);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(raw, max);
}

module.exports = { ApiError, asyncHandler, queryString, requireRow, limitParam };
