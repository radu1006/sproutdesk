'use strict';

/**
 * Date and time helpers. They are pure functions, so these tests need neither a
 * database nor a running server: `npm test` runs them as they are.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const dates = require('../src/lib/dates');

test('isDateOnly accepts real calendar dates', () => {
  assert.equal(dates.isDateOnly('2026-09-26'), true);
  assert.equal(dates.isDateOnly('2024-02-29'), true); // leap year
});

test('isDateOnly rejects impossible or malformed dates', () => {
  assert.equal(dates.isDateOnly('2026-02-29'), false);
  assert.equal(dates.isDateOnly('2026-13-01'), false);
  assert.equal(dates.isDateOnly('26/09/2026'), false);
  assert.equal(dates.isDateOnly('2026-9-6'), false);
  assert.equal(dates.isDateOnly(''), false);
  assert.equal(dates.isDateOnly(null), false);
  assert.equal(dates.isDateOnly(20260926), false);
});

test('isTimeOnly only accepts 24-hour HH:MM', () => {
  assert.equal(dates.isTimeOnly('00:00'), true);
  assert.equal(dates.isTimeOnly('08:30'), true);
  assert.equal(dates.isTimeOnly('23:59'), true);
  assert.equal(dates.isTimeOnly('24:00'), false);
  assert.equal(dates.isTimeOnly('8:30'), false);
  assert.equal(dates.isTimeOnly('08:60'), false);
  assert.equal(dates.isTimeOnly('08:30:00'), false);
});

test('addDays walks across month and year boundaries', () => {
  assert.equal(dates.addDays('2026-09-26', 7), '2026-10-03');
  assert.equal(dates.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(dates.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dates.addDays('2026-09-26', 0), '2026-09-26');
});

test('addMonths clamps to the end of the target month', () => {
  assert.equal(dates.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(dates.addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(dates.addMonths('2026-09-15', 12), '2027-09-15');
  assert.equal(dates.addMonths('2024-01-31', 1), '2024-02-29'); // leap year
});

test('lastWeekdays skips Saturdays and Sundays', () => {
  // 2026-09-28 is a Monday, so the weekday before it is Friday the 25th.
  assert.deepEqual(dates.lastWeekdays(2, '2026-09-28'), ['2026-09-25', '2026-09-28']);

  const week = dates.lastWeekdays(5, '2026-09-26'); // a Saturday
  assert.equal(week.length, 5);
  for (const day of week) {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    assert.ok(weekday >= 1 && weekday <= 5, `${day} should be a weekday`);
  }
  assert.equal(week.at(-1), '2026-09-25');
});

test('ageInYears ignores a birthday that has not happened yet', () => {
  assert.equal(dates.ageInYears('2019-09-26', '2026-09-26'), 7);
  assert.equal(dates.ageInYears('2019-09-27', '2026-09-26'), 6);
  assert.equal(dates.ageInYears('not-a-date', '2026-09-26'), null);
});

test('periodLabel and the ISO helpers agree on their convention', () => {
  assert.equal(dates.periodLabel('2026-09-26'), '2026-09');
  assert.match(dates.todayIso(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isFinite(Date.parse(dates.nowIso())));
});
