'use strict';

/**
 * SQL builders. They only produce strings and parameter arrays, so the exact
 * statements the routes send to SQLite/PostgreSQL can be pinned here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInsert, buildUpdate, normalise } = require('../src/lib/sql');

test('normalise turns booleans and dates into driver values', () => {
  assert.equal(normalise(true), 1);
  assert.equal(normalise(false), 0);
  assert.equal(normalise(new Date('2026-09-26T10:20:30.000Z')), '2026-09-26T10:20:30.000Z');
  assert.equal(normalise('text'), 'text');
  assert.equal(normalise(null), null);
  assert.equal(normalise(0), 0);
});

test('buildInsert skips undefined columns and binds every value', () => {
  const statement = buildInsert('users', {
    email: 'amy@sproutdesk.test',
    is_active: true,
    phone: undefined,
  });
  assert.equal(statement.sql, 'INSERT INTO users (email, is_active) VALUES (?, ?) RETURNING id');
  assert.deepEqual(statement.params, ['amy@sproutdesk.test', 1]);
});

test('buildInsert keeps columns that were explicitly nulled', () => {
  const statement = buildInsert('children', { allergies: null });
  assert.equal(statement.sql, 'INSERT INTO children (allergies) VALUES (?) RETURNING id');
  assert.deepEqual(statement.params, [null]);
});

test('buildInsert always appends RETURNING id', () => {
  // There is no opt-out: a table without an `id` column (such as the key/value
  // `settings` table, see src/routes/settings.js) needs its own hand-written
  // SQL, and an ON CONFLICT clause must sit *before* RETURNING.
  const statement = buildInsert('settings', { key: 'currency', value: 'USD' });
  assert.equal(statement.sql, 'INSERT INTO settings (key, value) VALUES (?, ?) RETURNING id');
  assert.deepEqual(statement.params, ['currency', 'USD']);
});

test('buildUpdate returns null when there is nothing to change', () => {
  assert.equal(buildUpdate('invoices', {}, 'id = ?', [1]), null);
  assert.equal(buildUpdate('invoices', { status: undefined }, 'id = ?', [1]), null);
});

test('buildUpdate appends the where parameters last', () => {
  const statement = buildUpdate(
    'invoices',
    { status: 'paid', amount_cents: 12000 },
    'id = ?',
    [7],
  );
  assert.equal(statement.sql, 'UPDATE invoices SET status = ?, amount_cents = ? WHERE id = ?');
  assert.deepEqual(statement.params, ['paid', 12000, 7]);
});

test('buildUpdate normalises values the same way as buildInsert', () => {
  // `users.is_active` is a real boolean column, so `false` binds as 0 while the
  // undefined `updated_at` is left out of the statement entirely.
  const statement = buildUpdate('users', { is_active: false, updated_at: undefined }, 'id = ?', [2]);
  assert.equal(statement.sql, 'UPDATE users SET is_active = ? WHERE id = ?');
  assert.deepEqual(statement.params, [0, 2]);
});
