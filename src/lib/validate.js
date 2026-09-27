'use strict';

/**
 * Input validation helpers. Each function returns a normalised value, `null`
 * for an explicitly cleared optional field, or `undefined` when the field was
 * simply not part of the request body. Invalid input raises a 400 ApiError.
 */

const bcrypt = require('bcryptjs');
const { badRequest } = require('./errors');
const dates = require('./dates');

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

function present(source, key) {
  if (!source || typeof source !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined;
}

function text(source, key, { required = false, min = 0, max = 4000, trim = true } = {}) {
  if (!present(source, key) || source[key] === null) {
    if (required) throw badRequest(`"${key}" is required.`, 'missing_field');
    return undefined;
  }
  let value = String(source[key]);
  if (trim) value = value.trim();
  if (value === '') {
    if (required) throw badRequest(`"${key}" cannot be empty.`, 'missing_field');
    return null;
  }
  if (value.length < min) throw badRequest(`"${key}" must be at least ${min} characters long.`);
  if (value.length > max) throw badRequest(`"${key}" must be at most ${max} characters long.`);
  return value;
}

function textOrNull(source, key, options = {}) {
  const value = text(source, key, options);
  return value === undefined ? undefined : value;
}

function integer(source, key, { required = false, min = -2147483648, max = 2147483647 } = {}) {
  if (!present(source, key) || source[key] === null || source[key] === '') {
    if (required) throw badRequest(`"${key}" is required.`, 'missing_field');
    return undefined;
  }
  const value = Number(source[key]);
  if (!Number.isInteger(value)) throw badRequest(`"${key}" must be a whole number.`);
  if (value < min || value > max) throw badRequest(`"${key}" must be between ${min} and ${max}.`);
  return value;
}

function money(source, key, { required = false, min = 0 } = {}) {
  if (!present(source, key) || source[key] === null || source[key] === '') {
    if (required) throw badRequest(`"${key}" is required.`, 'missing_field');
    return undefined;
  }
  const raw = Number(source[key]);
  if (!Number.isFinite(raw)) throw badRequest(`"${key}" must be a number.`);
  const cents = Math.round(raw * 100);
  if (cents < min) throw badRequest(`"${key}" cannot be negative.`);
  return cents;
}

function enumeration(source, key, allowed, { required = false, nullable = true } = {}) {
  if (!present(source, key)) {
    if (required) throw badRequest(`"${key}" is required.`, 'missing_field');
    return undefined;
  }
  if (source[key] === null || source[key] === '') {
    if (required) throw badRequest(`"${key}" is required.`, 'missing_field');
    // Explicitly cleared by the client: `null` clears the column, while an
    // absent field leaves it untouched. Non-nullable enums cannot be cleared.
    return nullable ? null : undefined;
  }
  const value = String(source[key]);
  if (!allowed.includes(value)) {
    throw badRequest(`"${key}" must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

function email(source, key, { required = false } = {}) {
  const value = text(source, key, { required, max: 254, trim: true });
  if (value === undefined) return undefined;
  if (value === null) {
    if (required) throw badRequest(`"${key}" is required.`, 'missing_field');
    return null;
  }
  const normalised = value.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalised)) {
    throw badRequest('Please provide a valid email address.');
  }
  return normalised;
}

function dateOnly(source, key, { required = false } = {}) {
  const value = text(source, key, { required, max: 10 });
  if (value === undefined) return undefined;
  if (value === null) {
    if (required) throw badRequest(`"${key}" is required.`, 'missing_field');
    return null;
  }
  if (!dates.isDateOnly(value)) throw badRequest(`"${key}" must be a date in YYYY-MM-DD format.`);
  return value;
}

function timeOnly(source, key, { required = false } = {}) {
  const value = text(source, key, { required, max: 5 });
  if (value === undefined) return undefined;
  if (value === null) {
    if (required) throw badRequest(`"${key}" is required.`, 'missing_field');
    return null;
  }
  if (!dates.isTimeOnly(value)) throw badRequest(`"${key}" must be a time in HH:MM format.`);
  return value;
}

function boolean(source, key, { fallback } = {}) {
  if (!present(source, key) || source[key] === null) return fallback;
  const value = source[key];
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  if (value === 'true' || value === 'false') return value === 'true';
  if (value === '0' || value === '1') return value === '1';
  throw badRequest(`"${key}" must be a boolean.`);
}

/** Reads `key` from the query string and validates it as an integer. */
function queryInteger(query, key, options = {}) {
  return integer(query || {}, key, options);
}

/** Applies defaults to missing (but not explicitly nulled) values. */
function withDefaults(data, defaults) {
  const result = { ...data };
  for (const [key, value] of Object.entries(defaults)) {
    if (result[key] === undefined) result[key] = value;
  }
  return result;
}

function assert(condition, message, code) {
  if (!condition) throw badRequest(message, code);
}

async function hashPassword(plain) {
  assert(
    typeof plain === 'string' && plain.length >= MIN_PASSWORD_LENGTH,
    `The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    'weak_password',
  );
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

module.exports = {
  present,
  text,
  textOrNull,
  integer,
  money,
  enum: enumeration,
  email,
  dateOnly,
  timeOnly,
  boolean,
  queryInteger,
  withDefaults,
  assert,
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
};
