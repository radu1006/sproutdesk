'use strict';

/**
 * Centre settings: the key/value `settings` table, plus the list of keys the API
 * is allowed to touch.
 *
 * This lives outside `src/routes/settings.js` because the routes that only need
 * to *read* a setting (the dashboard and the invoice summaries both report the
 * centre currency) should not have to pull in the settings router.
 *
 * Every value is stored as text, so callers coerce what they need.
 */

const db = require('../db');
const config = require('../config');
const currencies = require('./currencies');

/** Days 1-28 keep a monthly due date safe, even in February. */
function dueDayOptions() {
  return Array.from({ length: 28 }, (_, index) => ({
    value: String(index + 1),
    label: `Day ${index + 1}`,
  }));
}

/**
 * Whitelist: only these keys can be read or written through the API.
 * `options` marks the fields that are picked from a list rather than typed;
 * it travels to the browser with `GET /api/settings`.
 */
const EDITABLE = [
  { key: 'school_name', label: 'Centre name', max: 120 },
  { key: 'school_tagline', label: 'Tagline', max: 160 },
  { key: 'school_address', label: 'Address', max: 200 },
  { key: 'school_phone', label: 'Phone', max: 40 },
  { key: 'school_email', label: 'Email', max: 160 },
  { key: 'timezone', label: 'Timezone', max: 60 },
  { key: 'currency', label: 'Currency code', max: 3, options: currencies.options() },
  { key: 'default_due_day', label: 'Invoice due day (1-28)', max: 2, options: dueDayOptions() },
];

/** Every editable key, with `null` for the ones nobody has saved yet. */
async function read() {
  const rows = await db.all('SELECT key, value FROM settings');
  const values = {};
  for (const field of EDITABLE) values[field.key] = null;
  for (const row of rows) {
    if (values[row.key] !== undefined) values[row.key] = row.value;
  }
  return values;
}

/** One setting, or `null` when it was never saved. */
async function value(key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

/**
 * The currency the centre bills in: what an administrator saved, or the
 * `DEFAULT_CURRENCY` environment value on a fresh install. A value nobody can
 * pick any more (an old code, a typo) is ignored rather than shown.
 */
async function currency() {
  const saved = await value('currency');
  return currencies.isSupported(saved) ? currencies.normalise(saved) : config.locale.currency;
}

module.exports = { EDITABLE, dueDayOptions, read, value, currency };
