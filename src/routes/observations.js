'use strict';

/**
 * Learning observations: short notes attached to a child, one development
 * area and a progress level. Parents see the notes for their own children.
 */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow, limitParam } = require('../lib/http');
const { nowIso, todayIso, addDays } = require('../lib/dates');
const access = require('../lib/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const AREAS = ['language', 'motor', 'social', 'cognitive', 'creative', 'self_care'];
const LEVELS = ['emerging', 'developing', 'secure'];

const SELECT_OBSERVATION = `
  SELECT o.*, ch.first_name, ch.last_name, ch.classroom_id, u.full_name AS author_name
    FROM observations o
    JOIN children ch ON ch.id = o.child_id
    LEFT JOIN users u ON u.id = o.created_by
`;

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];

    const childId = v.queryInteger(req.query, 'childId', { min: 1 });
    if (childId) {
      await access.assertChildAccess(req.user, childId);
      conditions.push('o.child_id = ?');
      params.push(childId);
    } else {
      const ids = await access.accessibleChildIds(req.user);
      if (Array.isArray(ids)) {
        if (ids.length === 0) {
          res.json({ data: [] });
          return;
        }
        conditions.push(`o.child_id IN (${ids.map(() => '?').join(', ')})`);
        params.push(...ids);
      }
    }

    const area = v.enum(req.query, 'area', AREAS);
    if (area) {
      conditions.push('o.area = ?');
      params.push(area);
    }

    const to = v.dateOnly(req.query, 'to') ?? todayIso();
    const from = v.dateOnly(req.query, 'from') ?? addDays(to, -89);
    conditions.push('o.observed_on BETWEEN ? AND ?');
    params.push(from, to);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(
      `${SELECT_OBSERVATION} ${where} ORDER BY o.observed_on DESC, o.id DESC LIMIT ?`,
      [...params, limitParam(req.query, { fallback: 100, max: 300 })],
    );
    res.json({ data: rows.map(serialize.observation) });
  }),
);

/** Latest observation per development area, used by the progress panel. */
router.get(
  '/progress/:childId',
  asyncHandler(async (req, res) => {
    const child = await access.assertChildAccess(req.user, req.params.childId);

    const rows = await db.all(
      `SELECT o.area, o.level, o.observed_on
         FROM observations o
        WHERE o.child_id = ?
        ORDER BY o.observed_on DESC, o.id DESC`,
      [child.id],
    );

    const latest = new Map();
    for (const row of rows) {
      if (!latest.has(row.area)) latest.set(row.area, row);
    }

    res.json({
      data: {
        childId: Number(child.id),
        areas: AREAS.map((area) => ({
          area,
          level: latest.get(area)?.level ?? null,
          observedOn: latest.get(area)?.observed_on ?? null,
        })),
      },
    });
  }),
);

router.post(
  '/',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const childId = v.integer(req.body, 'childId', { required: true, min: 1 });
    const area = v.enum(req.body, 'area', AREAS, { required: true, nullable: false });
    const level = v.enum(req.body, 'level', LEVELS, { required: true, nullable: false });
    const observedOn = v.dateOnly(req.body, 'observedOn') ?? todayIso();
    const note = v.text(req.body, 'note', { max: 2000 });

    const child = await access.assertChildAccess(req.user, childId, { write: true });
    const now = nowIso();
    const { sql, params } = buildInsert('observations', {
      child_id: child.id,
      area,
      level,
      note: note ?? null,
      observed_on: observedOn,
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
    });
    const { id } = await db.run(sql, params);
    const row = await db.get(`${SELECT_OBSERVATION} WHERE o.id = ?`, [id]);
    res.status(201).json({ data: { observation: serialize.observation(row) } });
  }),
);

router.patch(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM observations WHERE id = ?', [req.params.id]);
    requireRow(row, 'That observation does not exist.');
    await access.assertChildAccess(req.user, row.child_id, { write: true });

    const observedOn = v.dateOnly(req.body, 'observedOn');
    if (observedOn) {
      v.assert(observedOn <= todayIso(), 'An observation cannot be dated in the future.');
    }

    const patch = {
      area: v.enum(req.body, 'area', AREAS, { nullable: false }),
      level: v.enum(req.body, 'level', LEVELS, { nullable: false }),
      note: v.text(req.body, 'note', { max: 2000 }),
      observed_on: observedOn,
      updated_at: nowIso(),
    };
    const statement = buildUpdate('observations', patch, 'id = ?', [row.id]);
    await db.run(statement.sql, statement.params);

    const updated = await db.get(`${SELECT_OBSERVATION} WHERE o.id = ?`, [row.id]);
    res.json({ data: { observation: serialize.observation(updated) } });
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM observations WHERE id = ?', [req.params.id]);
    requireRow(row, 'That observation does not exist.');
    await access.assertChildAccess(req.user, row.child_id, { write: true });
    await db.run('DELETE FROM observations WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, observationId: Number(row.id) } });
  }),
);

module.exports = router;
module.exports.AREAS = AREAS;
module.exports.LEVELS = LEVELS;
