'use strict';

/**
 * Currency catalogue (`src/lib/currencies.js`) and the centre settings fields
 * (`src/lib/centre.js`).
 *
 * The catalogue is the single source of truth behind three things: the picker on
 * the settings screen (`GET /api/settings`), the validator on
 * `PATCH /api/settings`, and `Intl.NumberFormat` in `public/js/ui.js`. That last
 * one throws on a code that is not a real ISO 4217 currency, so every entry is
 * checked here rather than discovered in the browser.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const currencies = require('../src/lib/currencies');
const centre = require('../src/lib/centre');

test('every currency is a unique, well-formed International ISO 4217 code', () => {
  assert.ok(currencies.CODES.length >= 20, 'the picker should offer a real choice');
  assert.equal(new Set(currencies.CODES).size, currencies.CODES.length, 'codes must not repeat');
  for (const code of currencies.CODES) assert.match(code, /^[A-Z]{3}$/);
  assert.deepEqual(currencies.CODES, [...currencies.CODES].sort(), 'the list stays alphabetical');
});

test('the euro and the Romanian leu are on the list', () => {
  assert.ok(currencies.isSupported('EUR'));
  assert.ok(currencies.isSupported('RON'));
  assert.equal(currencies.label('EUR'), 'EUR — Euro (€)');
  assert.equal(currencies.label('RON'), 'RON — Romanian leu (lei)');
});

test('lookups ignore case and surrounding spaces', () => {
  assert.equal(currencies.isSupported('ron'), true);
  assert.equal(currencies.isSupported('  Ron  '), true);
  assert.equal(currencies.normalise(' ron '), 'RON');
  assert.equal(currencies.label('eur'), 'EUR — Euro (€)');
});

test('unknown or malformed codes are rejected', () => {
  for (const value of ['', '  ', 'XX', 'XXXX', 'ZZZ', null, undefined, 42]) {
    assert.equal(currencies.isSupported(value), false, `${JSON.stringify(value)} must not pass`);
  }
  assert.equal(currencies.label('ZZZ'), 'ZZZ', 'an unknown code is echoed back');
});

test('options() is what a <select> needs', () => {
  const options = currencies.options();
  assert.equal(options.length, currencies.CODES.length);
  assert.deepEqual(
    options.map((option) => option.value),
    currencies.CODES,
  );
  assert.equal(new Set(options.map((option) => option.label)).size, options.length);
  for (const option of options) {
    assert.ok(option.label.startsWith(`${option.value} — `), option.label);
  }
});

test('Intl can format every code, so ui.fmtMoney never needs its fallback', () => {
  for (const code of currencies.CODES) {
    assert.doesNotThrow(
      () => new Intl.NumberFormat('en-US', { style: 'currency', currency: code }),
      `${code} must be a currency Intl knows`,
    );
  }
});

test('the settings fields offer a picker for currency and invoice due day', () => {
  const byKey = new Map(centre.EDITABLE.map((field) => [field.key, field]));

  assert.deepEqual(
    [...byKey.keys()],
    [
      'school_name',
      'school_tagline',
      'school_address',
      'school_phone',
      'school_email',
      'timezone',
      'currency',
      'default_due_day',
    ],
  );
  assert.deepEqual(byKey.get('currency').options, currencies.options());
  assert.equal(byKey.get('currency').max, 3);
  for (const field of ['school_name', 'school_tagline', 'school_address', 'school_phone', 'school_email', 'timezone']) {
    assert.equal(byKey.get(field).options, undefined, `${field} is typed, not picked`);
  }
});

test('due day options cover 1-28 so a February invoice stays valid', () => {
  const options = centre.dueDayOptions();
  assert.equal(options.length, 28);
  assert.deepEqual(options[0], { value: '1', label: 'Day 1' });
  assert.deepEqual(options[27], { value: '28', label: 'Day 28' });
  assert.deepEqual(centre.EDITABLE.find((field) => field.key === 'default_due_day').options, options);
});
