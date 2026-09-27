'use strict';

/**
 * Centre settings (name, contact details, currency, invoice due day).
 *
 * The keys, and the choices for the fields that are picked rather than typed,
 * live in `src/lib/centre.js` so the dashboard and the invoice summaries can
 * read the same values without going through this router.
 */

const express = require('express');
const db = require('../db');
const centre = require('../lib/centre');
const currencies = require('../lib/currencies');
const v = require('../lib/validate');
const { asyncHandler } = require('../lib/http');
const { nowIso } = require('../lib/dates');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const KEYS = new Map(centre.EDITABLE.map((field) => [field.key, field]));

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      data: {
        settings: await centre.read(),
        // Drives the settings form in the frontend: labels, limits and the
        // options of the fields that are chosen from a list (currency, due day).
        schema: centre.EDITABLE.map((field) => ({
          key: field.key,
          label: field.label,
          options: field.options,
        })),
        canEdit: req.user.role === 'admin',
        engine: db.dialect,
      },
    });
  }),
);

router.patch(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const updates = {};
    for (const [key, raw] of Object.entries(req.body ?? {})) {
      const field = KEYS.get(key);
      v.assert(field, `"${key}" is not a setting you can change here.`);
      const value = v.text({ [key]: raw }, key, { max: field.max });
      if (value === null) {
        // Clearing a setting is not supported: keep the previous value.
        continue;
      }
      updates[key] = value;
    }
    v.assert(Object.keys(updates).length > 0, 'No settings were supplied.');

    if (updates.currency) {
      v.assert(
        currencies.isSupported(updates.currency),
        `"currency" must be one of: ${currencies.CODES.join(', ')}.`,
      );
      updates.currency = currencies.normalise(updates.currency);
    }
    if (updates.default_due_day) {
      const day = Number(updates.default_due_day);
      v.assert(
        Number.isInteger(day) && day >= 1 && day <= 28,
        '"default_due_day" must be a whole number between 1 and 28.',
      );
    }

    const now = nowIso();
    for (const [key, value] of Object.entries(updates)) {
      // `settings` is keyed by `key` and has no `id` column, so the upsert is
      // written out by hand instead of going through `buildInsert()` (which
      // appends `RETURNING id` and would not be valid here).
      await db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        [key, value],
      );
    }

    res.json({ data: { settings: await centre.read(), savedAt: now } });
  }),
);

module.exports = router;
// Kept working for callers that used to import these from the route module.
module.exports.readSettings = centre.read;
module.exports.EDITABLE = centre.EDITABLE;

