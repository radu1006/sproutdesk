'use strict';

/**
 * Validation helpers. They are the contract between the SPA and the database,
 * so every rule the routes depend on is pinned here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('../src/lib/validate');

/** Runs `fn` and checks the ApiError it is expected to throw. */
function expectBadRequest(fn, { code, match } = {}) {
  return assert.throws(fn, (error) => {
    assert.equal(error.name, 'ApiError');
    assert.equal(error.status, 400);
    if (code) assert.equal(error.code, code);
    if (match) assert.match(error.message, match);
    return true;
  });
}

test('present separates "not sent" from "sent as null"', () => {
  assert.equal(v.present({ a: 1 }, 'a'), true);
  assert.equal(v.present({ a: null }, 'a'), true);
  assert.equal(v.present({ a: 0 }, 'a'), true);
  assert.equal(v.present({ a: undefined }, 'a'), false);
  assert.equal(v.present({}, 'a'), false);
  assert.equal(v.present(null, 'a'), false);
  assert.equal(v.present('text', 'a'), false);
});

test('text trims, enforces limits and reports missing required fields', () => {
  assert.equal(v.text({ name: '  Sunflowers  ' }, 'name'), 'Sunflowers');
  assert.equal(v.text({ name: 'Sunflowers' }, 'name'), 'Sunflowers');
  assert.equal(v.text({}, 'name'), undefined);
  assert.equal(v.text({ name: '' }, 'name'), null);
  assert.equal(v.text({ name: '   ' }, 'name'), null);
  // An explicit null means "not sent", so the caller leaves the column alone.
  assert.equal(v.text({ name: null }, 'name'), undefined);
  assert.equal(v.text({ password: '  spaced  ' }, 'password', { trim: false }), '  spaced  ');

  expectBadRequest(() => v.text({}, 'title', { required: true }), {
    code: 'missing_field',
    match: /"title" is required/,
  });
  expectBadRequest(() => v.text({ title: '   ' }, 'title', { required: true }), {
    code: 'missing_field',
  });
  expectBadRequest(() => v.text({ title: 'abc' }, 'title', { max: 2 }), { match: /at most 2 characters/ });
  expectBadRequest(() => v.text({ title: 'a' }, 'title', { min: 2 }), { match: /at least 2 characters/ });
});

test('integer accepts numeric strings and rejects fractions', () => {
  assert.equal(v.integer({ childId: '7' }, 'childId'), 7);
  assert.equal(v.integer({ childId: 7 }, 'childId'), 7);
  assert.equal(v.integer({ childId: '' }, 'childId'), undefined);
  assert.equal(v.integer({ childId: null }, 'childId'), undefined);
  assert.equal(v.integer({}, 'childId'), undefined);

  expectBadRequest(() => v.integer({ childId: 1.5 }, 'childId'), { match: /whole number/ });
  expectBadRequest(() => v.integer({ childId: 'abc' }, 'childId'), { match: /whole number/ });
  expectBadRequest(() => v.integer({ childId: 0 }, 'childId', { min: 1 }), {
    match: /between 1 and 2147483647/,
  });
  expectBadRequest(() => v.integer({}, 'childId', { required: true }), { code: 'missing_field' });
  expectBadRequest(() => v.integer({ childId: '' }, 'childId', { required: true }), {
    code: 'missing_field',
  });
});

test('money converts a displayed amount into integer cents', () => {
  assert.equal(v.money({ amount: 120 }, 'amount'), 12000);
  assert.equal(v.money({ amount: '120.50' }, 'amount'), 12050);
  assert.equal(v.money({ amount: 1.239 }, 'amount'), 124);
  assert.equal(v.money({ amount: 0 }, 'amount'), 0);
  assert.equal(v.money({ amount: '' }, 'amount'), undefined);
  assert.equal(v.money({}, 'amount'), undefined);
  assert.equal(v.money({ amount: -5 }, 'amount', { min: -1000 }), -500);

  expectBadRequest(() => v.money({}, 'amount', { required: true }), { code: 'missing_field' });
  expectBadRequest(() => v.money({ amount: 'abc' }, 'amount'), { match: /must be a number/ });
  expectBadRequest(() => v.money({ amount: -5 }, 'amount'), { match: /cannot be negative/ });
});

test('enum accepts listed values and understands explicit clearing', () => {
  const allowed = ['unpaid', 'partial', 'paid', 'void'];

  assert.equal(v.enum({ status: 'paid' }, 'status', allowed), 'paid');
  assert.equal(v.enum({ status: '' }, 'status', allowed), null);
  assert.equal(v.enum({ status: null }, 'status', allowed), null);
  assert.equal(v.enum({}, 'status', allowed), undefined);
  assert.equal(v.enum({ status: '' }, 'status', allowed, { nullable: false }), undefined);

  expectBadRequest(() => v.enum({ status: 'sent' }, 'status', allowed), {
    match: /must be one of: unpaid, partial, paid, void/,
  });
  expectBadRequest(() => v.enum({}, 'status', allowed, { required: true }), { code: 'missing_field' });
  expectBadRequest(() => v.enum({ status: '' }, 'status', allowed, { required: true }), {
    code: 'missing_field',
  });
});

test('email lower-cases and validates the address', () => {
  assert.equal(v.email({ email: '  Amy@SproutDesk.TEST ' }, 'email'), 'amy@sproutdesk.test');
  assert.equal(v.email({}, 'email'), undefined);
  assert.equal(v.email({ email: '' }, 'email'), null);

  expectBadRequest(() => v.email({ email: 'amy@localhost' }, 'email'), { match: /valid email address/ });
  expectBadRequest(() => v.email({ email: 'amy@sproutdesk' }, 'email'), { match: /valid email address/ });
  expectBadRequest(() => v.email({}, 'email', { required: true }), { code: 'missing_field' });
});

test('dateOnly and timeOnly enforce their formats', () => {
  assert.equal(v.dateOnly({ date: '2026-09-26' }, 'date'), '2026-09-26');
  assert.equal(v.dateOnly({}, 'date'), undefined);
  assert.equal(v.dateOnly({ date: '' }, 'date'), null);
  assert.equal(v.timeOnly({ checkInTime: '09:05' }, 'checkInTime'), '09:05');
  assert.equal(v.timeOnly({ checkInTime: '' }, 'checkInTime'), null);

  expectBadRequest(() => v.dateOnly({ date: '2026-02-30' }, 'date'), { match: /YYYY-MM-DD/ });
  expectBadRequest(() => v.dateOnly({}, 'date', { required: true }), { code: 'missing_field' });
  expectBadRequest(() => v.timeOnly({ checkInTime: '9:05' }, 'checkInTime'), { match: /HH:MM/ });
});

test('boolean reads query strings, numbers and bodies', () => {
  assert.equal(v.boolean({ unreadOnly: 'true' }, 'unreadOnly', { fallback: false }), true);
  assert.equal(v.boolean({ unreadOnly: '1' }, 'unreadOnly', { fallback: false }), true);
  assert.equal(v.boolean({ unreadOnly: '0' }, 'unreadOnly', { fallback: false }), false);
  assert.equal(v.boolean({ allDay: true }, 'allDay'), true);
  assert.equal(v.boolean({ allDay: false }, 'allDay'), false);
  assert.equal(v.boolean({ allDay: 1 }, 'allDay'), true);
  assert.equal(v.boolean({ allDay: 0 }, 'allDay'), false);
  assert.equal(v.boolean({}, 'allDay', { fallback: false }), false);
  assert.equal(v.boolean({ allDay: null }, 'allDay', { fallback: 'x' }), 'x');

  expectBadRequest(() => v.boolean({ allDay: 'yes' }, 'allDay'), { match: /must be a boolean/ });
});

test('withDefaults only fills values that were not sent at all', () => {
  assert.deepEqual(v.withDefaults({ b: null }, { a: 1, b: 2 }), { a: 1, b: null });
  assert.deepEqual(v.withDefaults(null, { a: 1 }), { a: 1 });
});

test('queryInteger reads integers straight off the query string', () => {
  assert.equal(v.queryInteger({ limit: '20' }, 'limit'), 20);
  assert.equal(v.queryInteger({}, 'limit'), undefined);
  expectBadRequest(() => v.queryInteger({ childId: 'x' }, 'childId'), { match: /whole number/ });
});

test('assert throws a 400 carrying the caller supplied code', () => {
  assert.equal(v.assert(true, 'never thrown'), undefined);
  expectBadRequest(() => v.assert(false, 'That child has billing history.', 'child_has_invoices'), {
    code: 'child_has_invoices',
    match: /billing history/,
  });
});

test('passwords must be long enough and verify against their hash', async () => {
  assert.equal(v.MIN_PASSWORD_LENGTH, 8);
  await assert.rejects(v.hashPassword('short1'), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'weak_password');
    return true;
  });

  const hash = await v.hashPassword('Teacher123!');
  assert.match(hash, /^\$2[aby]\$/);
  assert.equal(await v.verifyPassword('Teacher123!', hash), true);
  assert.equal(await v.verifyPassword('Teacher124!', hash), false);
  assert.equal(await v.verifyPassword('Teacher123!', null), false);
  assert.equal(await v.verifyPassword(undefined, hash), false);
  assert.equal(await v.verifyPassword('Teacher123!', 'not-a-hash'), false);
});
