'use strict';

/**
 * Date/time helpers. The whole application stores timestamps as ISO-8601 UTC
 * strings and calendar dates as 'YYYY-MM-DD' strings, which keeps SQL simple
 * and behaves identically on SQLite and PostgreSQL.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return nowIso().slice(0, 10);
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimeOnly(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

function addDays(dateOnly, days) {
  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function addMonths(dateOnly, months) {
  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  const day = parsed.getUTCDate();
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
  parsed.setUTCDate(Math.min(day, lastDay));
  return parsed.toISOString().slice(0, 10);
}

/** `[2026-09-22, 2026-09-23, ...]` ending with the given date (default today). */
function lastWeekdays(count, endDate = todayIso()) {
  const dates = [];
  let cursor = endDate;
  while (dates.length < count) {
    const day = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return dates.reverse();
}

function ageInYears(dateOfBirth, onDate = todayIso()) {
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const at = new Date(`${onDate}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/** '2026-09' - used as the billing period label. */
function periodLabel(dateOnly = todayIso()) {
  return dateOnly.slice(0, 7);
}

module.exports = {
  nowIso,
  todayIso,
  isDateOnly,
  isTimeOnly,
  addDays,
  addMonths,
  lastWeekdays,
  ageInYears,
  periodLabel,
};
