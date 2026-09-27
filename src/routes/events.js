'use strict';

/**
 * Calendar events (outings, parent evenings, holidays) shown in the events
 * view and in the dashboard "coming up" panel.
 */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow, limitParam } = require('../lib/http');
const { nowIso, todayIso, addDays } = require('../lib/dates');
const { forbidden } = require('../lib/errors');
const access = require('../lib/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const AUDIENCES = ['all', 'teachers', 'parents'];

router.use(requireAuth);

/** Keeps classroom-specific events hidden from unrelated families. */
async function classroomScope(user, alias = 'e') {
  if (user.role === 'admin') return { sql: '', params: [] };
  const ids = await access.visibleClassroomIds(user);
  if (!Array.isArray(ids) || ids.length === 0) {
    return { sql: `${alias}.classroom_id IS NULL`, params: [] };
  }
  const placeholders = ids.map(() => '?').join(', ');
  return {
    sql: `(${alias}.classroom_id IS NULL OR ${alias}.classroom_id IN (${placeholders}))`,
    params: ids,
  };
}

/** Teachers also see the events addressed to them, parents see theirs. */
function audienceForRole(role) {
  if (role === 'parent') return `e.audience IN ('all', 'parents')`;
  if (role === 'teacher') return `e.audience IN ('all', 'teachers')`;
  return null;
}

async function listEvents(user, { from, to, limit }) {
  const conditions = ['e.starts_at >= ?', 'e.starts_at <= ?'];
  const params = [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`];

  const scope = await classroomScope(user);
  if (scope.sql) {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }

  const audienceClause = audienceForRole(user.role);
  if (audienceClause) conditions.push(audienceClause);

  return db.all(
    `SELECT e.* FROM events e WHERE ${conditions.join(' AND ')} ORDER BY e.starts_at LIMIT ?`,
    [...params, limit],
  );
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const to = v.dateOnly(req.query, 'to') ?? addDays(todayIso(), 60);
    const from = v.dateOnly(req.query, 'from') ?? addDays(todayIso(), -30);
    v.assert(from <= to, '"from" must not be after "to".');

    const rows = await listEvents(req.user, {
      from,
      to,
      limit: limitParam(req.query, { fallback: 100, max: 300 }),
    });
    res.json({ data: rows.map(serialize.event) });
  }),
);

router.get(
  '/upcoming',
  asyncHandler(async (req, res) => {
    const rows = await listEvents(req.user, {
      from: todayIso(),
      to: addDays(todayIso(), 45),
      limit: limitParam(req.query, { fallback: 5, max: 50 }),
    });
    res.json({ data: rows.map(serialize.event) });
  }),
);

router.post(
  '/',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const title = v.text(req.body, 'title', { required: true, max: 160 });
    const startsAt = v.text(req.body, 'startsAt', { required: true, max: 30 });
    v.assert(!Number.isNaN(Date.parse(startsAt)), '"startsAt" must be an ISO-8601 date/time.');

    const endsAt = v.text(req.body, 'endsAt', { max: 30 });
    if (endsAt) {
      v.assert(!Number.isNaN(Date.parse(endsAt)), '"endsAt" must be an ISO-8601 date/time.');
      v.assert(Date.parse(endsAt) >= Date.parse(startsAt), '"endsAt" must not precede "startsAt".');
    }

    const classroomId = v.integer(req.body, 'classroomId', { min: 1 });
    if (classroomId) {
      await access.assertClassroomAccess(req.user, classroomId, { write: true });
    } else if (req.user.role === 'teacher') {
      throw forbidden('Educators add events to one of their classrooms.');
    }

    const description = v.text(req.body, 'description', { max: 2000 });
    const location = v.text(req.body, 'location', { max: 160 });
    const allDay = v.boolean(req.body, 'allDay', { fallback: false });
    const audience = v.enum(req.body, 'audience', AUDIENCES, { nullable: false }) ?? 'all';

    const now = nowIso();
    const { sql, params } = buildInsert('events', {
      title,
      description: description ?? null,
      location: location ?? null,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      all_day: allDay ? 1 : 0,
      audience,
      classroom_id: classroomId ?? null,
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
    });
    const { id } = await db.run(sql, params);
    const row = await db.get('SELECT * FROM events WHERE id = ?', [id]);
    res.status(201).json({ data: { event: serialize.event(row) } });
  }),
);

router.patch(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    requireRow(row, 'That event does not exist.');
    if (req.user.role !== 'admin' && Number(row.created_by) !== Number(req.user.id)) {
      throw forbidden('You can only change events you created.');
    }

    const startsAt = v.text(req.body, 'startsAt', { max: 30 });
    if (startsAt) v.assert(!Number.isNaN(Date.parse(startsAt)), '"startsAt" is not a valid date.');

    const endsAt = v.text(req.body, 'endsAt', { max: 30 });
    if (endsAt) v.assert(!Number.isNaN(Date.parse(endsAt)), '"endsAt" is not a valid date.');

    const allDay = v.boolean(req.body, 'allDay');
    const patch = {
      title: v.text(req.body, 'title', { max: 160 }),
      description: v.text(req.body, 'description', { max: 2000 }),
      location: v.text(req.body, 'location', { max: 160 }),
      starts_at: startsAt ? new Date(startsAt).toISOString() : undefined,
      ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
      all_day: allDay === undefined ? undefined : allDay ? 1 : 0,
      audience: v.enum(req.body, 'audience', AUDIENCES, { nullable: false }),
      updated_at: nowIso(),
    };

    if (req.body.classroomId !== undefined) {
      const classroomId = v.integer(req.body, 'classroomId', { min: 1 });
      if (classroomId) await access.assertClassroomAccess(req.user, classroomId, { write: true });
      patch.classroom_id = classroomId ?? null;
    }

    const statement = buildUpdate('events', patch, 'id = ?', [row.id]);
    if (statement) await db.run(statement.sql, statement.params);

    const updated = await db.get('SELECT * FROM events WHERE id = ?', [row.id]);
    res.json({ data: { event: serialize.event(updated) } });
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    requireRow(row, 'That event does not exist.');
    if (req.user.role !== 'admin' && Number(row.created_by) !== Number(req.user.id)) {
      throw forbidden('You can only delete events you created.');
    }
    await db.run('DELETE FROM events WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, eventId: Number(row.id) } });
  }),
);

module.exports = router;
module.exports.AUDIENCES = AUDIENCES;
