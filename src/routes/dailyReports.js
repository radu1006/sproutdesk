'use strict';

/**
 * Daily reports: one wellbeing sheet per child per day (meals, nap, mood,
 * activities and the teacher's note), visible to that child's parents.
 */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow } = require('../lib/http');
const { nowIso, todayIso, addDays } = require('../lib/dates');
const access = require('../lib/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const MOODS = ['happy', 'calm', 'tired', 'upset', 'energetic'];
const MEALS = ['all', 'most', 'some', 'none'];

const SELECT_REPORT = `
  SELECT r.*, ch.first_name, ch.last_name, ch.classroom_id
    FROM daily_reports r
    JOIN children ch ON ch.id = r.child_id
`;

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const childId = v.queryInteger(req.query, 'childId', { min: 1 });
    const from = v.dateOnly(req.query, 'from');
    const to = v.dateOnly(req.query, 'to');
    const date = v.dateOnly(req.query, 'date');

    const conditions = [];
    const params = [];

    if (childId) {
      await access.assertChildAccess(req.user, childId);
      conditions.push('r.child_id = ?');
      params.push(childId);
    } else {
      const ids = await access.accessibleChildIds(req.user);
      if (Array.isArray(ids)) {
        if (ids.length === 0) {
          res.json({ data: [] });
          return;
        }
        conditions.push(`r.child_id IN (${ids.map(() => '?').join(', ')})`);
        params.push(...ids);
      }
    }

    if (date) {
      conditions.push('r.report_date = ?');
      params.push(date);
    } else {
      const end = to ?? todayIso();
      const start = from ?? addDays(end, -6);
      v.assert(start <= end, '"from" must not be after "to".');
      conditions.push('r.report_date BETWEEN ? AND ?');
      params.push(start, end);
    }

    const classroomId = v.queryInteger(req.query, 'classroomId', { min: 1 });
    if (classroomId) {
      conditions.push('ch.classroom_id = ?');
      params.push(classroomId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(
      `${SELECT_REPORT} ${where} ORDER BY r.report_date DESC, ch.first_name LIMIT 500`,
      params,
    );
    res.json({ data: rows.map(serialize.dailyReport) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get(`${SELECT_REPORT} WHERE r.id = ?`, [req.params.id]);
    requireRow(row, 'That daily report does not exist.');
    await access.assertChildAccess(req.user, row.child_id);
    res.json({ data: { report: serialize.dailyReport(row) } });
  }),
);

/** Creates the sheet for a child/day or updates it if it already exists. */
router.put(
  '/',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const childId = v.integer(req.body, 'childId', { required: true, min: 1 });
    const date = v.dateOnly(req.body, 'date') ?? todayIso();
    const child = await access.assertChildAccess(req.user, childId, { write: true });

    const patch = {
      mood: v.enum(req.body, 'mood', MOODS),
      breakfast: v.enum(req.body, 'breakfast', MEALS),
      lunch: v.enum(req.body, 'lunch', MEALS),
      snack: v.enum(req.body, 'snack', MEALS),
      nap_minutes: v.integer(req.body, 'napMinutes', { min: 0, max: 720 }),
      toilet_notes: v.text(req.body, 'toiletNotes', { max: 500 }),
      activities: v.text(req.body, 'activities', { max: 1000 }),
      teacher_note: v.text(req.body, 'teacherNote', { max: 2000 }),
      updated_at: nowIso(),
    };

    const existing = await db.get(
      'SELECT * FROM daily_reports WHERE child_id = ? AND report_date = ?',
      [child.id, date],
    );

    let id;
    let created;
    if (existing) {
      const statement = buildUpdate('daily_reports', patch, 'id = ?', [existing.id]);
      await db.run(statement.sql, statement.params);
      id = Number(existing.id);
      created = false;
    } else {
      const { sql, params } = buildInsert('daily_reports', {
        child_id: child.id,
        report_date: date,
        created_by: req.user.id,
        created_at: nowIso(),
        ...patch,
      });
      ({ id } = await db.run(sql, params));
      created = true;
    }

    const row = await db.get(`${SELECT_REPORT} WHERE r.id = ?`, [id]);
    res.status(created ? 201 : 200).json({
      data: { report: serialize.dailyReport(row), created },
    });
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM daily_reports WHERE id = ?', [req.params.id]);
    requireRow(row, 'That daily report does not exist.');
    await access.assertChildAccess(req.user, row.child_id, { write: true });
    await db.run('DELETE FROM daily_reports WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, reportId: Number(row.id) } });
  }),
);

module.exports = router;
module.exports.MOODS = MOODS;
module.exports.MEALS = MEALS;
