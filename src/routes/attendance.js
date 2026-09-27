'use strict';

/**
 * Attendance register: one record per child per day, plus quick whole-class
 * registration and per-day summaries for the dashboard.
 */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow, queryString } = require('../lib/http');
const { nowIso, todayIso, addDays } = require('../lib/dates');
const { badRequest } = require('../lib/errors');
const access = require('../lib/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const STATUSES = ['present', 'absent', 'late', 'sick', 'holiday'];
const ABSENT_STATUSES = ['absent', 'sick', 'holiday'];

const SELECT_ATTENDANCE = `
  SELECT a.*, ch.first_name, ch.last_name, ch.classroom_id
    FROM attendance a
    JOIN children ch ON ch.id = a.child_id
`;

router.use(requireAuth);

/** Writes (or clears) the arrival times that make sense for a status. */
function timeFor(status, requested) {
  return ABSENT_STATUSES.includes(status) ? null : requested;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const date = v.dateOnly(req.query, 'date') ?? todayIso();
    const classroomId = v.queryInteger(req.query, 'classroomId', { min: 1 });
    const childId = v.queryInteger(req.query, 'childId', { min: 1 });

    const conditions = ['a.attendance_date = ?'];
    const params = [date];

    if (childId) {
      await access.assertChildAccess(req.user, childId);
      conditions.push('a.child_id = ?');
      params.push(childId);
    } else {
      const ids = await access.accessibleChildIds(req.user);
      if (Array.isArray(ids)) {
        if (ids.length === 0) {
          res.json({ data: { date, records: [], summary: { total: 0 } } });
          return;
        }
        conditions.push(`a.child_id IN (${ids.map(() => '?').join(', ')})`);
        params.push(...ids);
      }
    }

    if (classroomId) {
      conditions.push('ch.classroom_id = ?');
      params.push(classroomId);
    }

    const rows = await db.all(
      `${SELECT_ATTENDANCE} WHERE ${conditions.join(' AND ')} ORDER BY ch.first_name, ch.last_name`,
      params,
    );

    const summary = { total: rows.length };
    for (const status of STATUSES) summary[status] = 0;
    for (const row of rows) summary[row.status] = (summary[row.status] ?? 0) + 1;

    res.json({ data: { date, records: rows.map(serialize.attendance), summary } });
  }),
);

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const to = v.dateOnly(req.query, 'to') ?? todayIso();
    const from = v.dateOnly(req.query, 'from') ?? addDays(to, -29);
    v.assert(from <= to, '"from" must not be after "to".');

    const conditions = ['a.attendance_date BETWEEN ? AND ?'];
    const params = [from, to];

    const classroomId = v.queryInteger(req.query, 'classroomId', { min: 1 });
    if (classroomId) {
      conditions.push('ch.classroom_id = ?');
      params.push(classroomId);
    }

    const ids = await access.accessibleChildIds(req.user);
    if (Array.isArray(ids)) {
      if (ids.length === 0) {
        res.json({ data: { from, to, days: [] } });
        return;
      }
      conditions.push(`a.child_id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }

    const rows = await db.all(
      `SELECT a.attendance_date AS day, a.status, COUNT(*) AS total
         FROM attendance a
         JOIN children ch ON ch.id = a.child_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY a.attendance_date, a.status
        ORDER BY a.attendance_date`,
      params,
    );

    const byDay = new Map();
    for (const row of rows) {
      if (!byDay.has(row.day)) {
        byDay.set(row.day, { date: row.day, present: 0, absent: 0, late: 0, sick: 0, holiday: 0 });
      }
      byDay.get(row.day)[row.status] = Number(row.total);
    }

    res.json({ data: { from, to, days: [...byDay.values()] } });
  }),
);

/** Creates or updates one child's attendance record for a day. */
async function saveRecord(user, { childId, date, status, checkInTime, checkOutTime, note }) {
  const child = await access.assertChildAccess(user, childId, { write: true });

  const existing = await db.get(
    'SELECT * FROM attendance WHERE child_id = ? AND attendance_date = ?',
    [child.id, date],
  );
  const now = nowIso();

  if (existing) {
    const patch = {
      status,
      check_in_time: timeFor(status, checkInTime),
      check_out_time: timeFor(status, checkOutTime ?? existing.check_out_time),
      recorded_by: user.id,
      updated_at: now,
    };
    if (note !== undefined) patch.note = note;
    const statement = buildUpdate('attendance', patch, 'id = ?', [existing.id]);
    await db.run(statement.sql, statement.params);
    return { id: Number(existing.id), created: false };
  }

  const { sql, params } = buildInsert('attendance', {
    child_id: child.id,
    attendance_date: date,
    status,
    check_in_time: timeFor(status, checkInTime),
    check_out_time: timeFor(status, checkOutTime),
    note: note ?? null,
    recorded_by: user.id,
    created_at: now,
    updated_at: now,
  });
  const { id } = await db.run(sql, params);
  return { id: Number(id), created: true };
}

router.post(
  '/',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const childId = v.integer(req.body, 'childId', { required: true, min: 1 });
    const date = v.dateOnly(req.body, 'date') ?? todayIso();
    const status = v.enum(req.body, 'status', STATUSES, { required: true, nullable: false });
    const checkInTime = v.timeOnly(req.body, 'checkInTime');
    const checkOutTime = v.timeOnly(req.body, 'checkOutTime');
    const note = v.text(req.body, 'note', { max: 500 });

    const saved = await saveRecord(req.user, {
      childId,
      date,
      status,
      checkInTime,
      checkOutTime,
      note,
    });
    const row = await db.get(`${SELECT_ATTENDANCE} WHERE a.id = ?`, [saved.id]);

    res.status(saved.created ? 201 : 200).json({
      data: { record: serialize.attendance(row), created: saved.created },
    });
  }),
);

router.post(
  '/bulk',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const date = v.dateOnly(req.body, 'date') ?? todayIso();
    const entries = req.body?.entries;
    v.assert(Array.isArray(entries) && entries.length > 0, '"entries" must be a non-empty array.');
    v.assert(entries.length <= 200, '"entries" may contain at most 200 rows.');

    const results = [];
    for (const entry of entries) {
      const childId = v.integer(entry, 'childId', { required: true, min: 1 });
      const status = v.enum(entry, 'status', STATUSES, { required: true, nullable: false });
      const checkInTime = v.timeOnly(entry, 'checkInTime');
      const note = v.text(entry, 'note', { max: 500 });
      const saved = await saveRecord(req.user, { childId, date, status, checkInTime, note });
      results.push({ childId, id: saved.id, created: saved.created, status });
    }

    res.json({ data: { date, saved: results.length, records: results } });
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM attendance WHERE id = ?', [req.params.id]);
    requireRow(row, 'That attendance record does not exist.');
    await access.assertChildAccess(req.user, row.child_id, { write: true });
    await db.run('DELETE FROM attendance WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, attendanceId: Number(row.id) } });
  }),
);

module.exports = router;
module.exports.STATUSES = STATUSES;
