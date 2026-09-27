'use strict';

/** Classrooms / groups (rooms). */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow } = require('../lib/http');
const { nowIso } = require('../lib/dates');
const { badRequest, conflict } = require('../lib/errors');
const access = require('../lib/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const LIST_SQL = `
  SELECT c.*,
         u.full_name AS lead_teacher_name,
         (SELECT COUNT(*) FROM children ch
           WHERE ch.classroom_id = c.id AND ch.enrollment_status <> 'archived') AS child_count
    FROM classrooms c
    LEFT JOIN users u ON u.id = c.lead_teacher_id
`;

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const visible = await access.visibleClassroomIds(req.user);
    let rows;
    if (visible === null) {
      rows = await db.all(`${LIST_SQL} ORDER BY c.name`);
    } else if (visible.length === 0) {
      rows = [];
    } else {
      const placeholders = visible.map(() => '?').join(', ');
      rows = await db.all(`${LIST_SQL} WHERE c.id IN (${placeholders}) ORDER BY c.name`, visible);
    }
    res.json({ data: rows.map(serialize.classroom) });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const name = v.text(req.body, 'name', { required: true, max: 80 });
    const ageGroup = v.text(req.body, 'ageGroup', { max: 40 });
    const capacity = v.integer(req.body, 'capacity', { min: 1, max: 200 });
    const roomLabel = v.text(req.body, 'roomLabel', { max: 60 });
    const leadTeacherId = v.integer(req.body, 'leadTeacherId', { min: 1 });
    const notes = v.text(req.body, 'notes', { max: 1000 });

    const clash = await db.get('SELECT id FROM classrooms WHERE name = ?', [name]);
    if (clash) throw conflict('A classroom with that name already exists.');

    if (leadTeacherId) {
      const teacher = await db.get('SELECT id, role FROM users WHERE id = ?', [leadTeacherId]);
      if (!teacher) throw badRequest('The selected lead educator does not exist.');
      if (teacher.role !== 'teacher' && teacher.role !== 'admin') {
        throw badRequest('Only educators or administrators can lead a classroom.');
      }
    }

    const now = nowIso();
    const { sql, params } = buildInsert('classrooms', {
      name,
      age_group: ageGroup ?? null,
      capacity: capacity ?? 20,
      room_label: roomLabel ?? null,
      lead_teacher_id: leadTeacherId ?? null,
      notes: notes ?? null,
      created_at: now,
      updated_at: now,
    });
    const { id } = await db.run(sql, params);
    const row = await db.get(`${LIST_SQL} WHERE c.id = ?`, [id]);
    res.status(201).json({ data: { classroom: serialize.classroom(row) } });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await access.assertClassroomAccess(req.user, req.params.id);
    const row = await db.get(`${LIST_SQL} WHERE c.id = ?`, [req.params.id]);
    requireRow(row, 'That classroom does not exist.');

    const roster = await db.all(
      `SELECT ch.*, cl.name AS classroom_name
         FROM children ch
         LEFT JOIN classrooms cl ON cl.id = ch.classroom_id
        WHERE ch.classroom_id = ? AND ch.enrollment_status <> 'archived'
        ORDER BY ch.first_name, ch.last_name`,
      [req.params.id],
    );

    res.json({
      data: { classroom: serialize.classroom(row), roster: roster.map(serialize.child) },
    });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM classrooms WHERE id = ?', [req.params.id]);
    requireRow(row, 'That classroom does not exist.');

    const name = v.text(req.body, 'name', { max: 80 });
    if (name && name !== row.name) {
      const clash = await db.get('SELECT id FROM classrooms WHERE name = ? AND id <> ?', [
        name,
        row.id,
      ]);
      if (clash) throw conflict('Another classroom already uses that name.');
    }

    const patch = {
      name,
      age_group: v.text(req.body, 'ageGroup', { max: 40 }),
      capacity: v.integer(req.body, 'capacity', { min: 1, max: 200 }),
      room_label: v.text(req.body, 'roomLabel', { max: 60 }),
      lead_teacher_id: v.integer(req.body, 'leadTeacherId', { min: 1 }),
      notes: v.text(req.body, 'notes', { max: 1000 }),
      updated_at: nowIso(),
    };
    const statement = buildUpdate('classrooms', patch, 'id = ?', [row.id]);
    if (statement) await db.run(statement.sql, statement.params);

    const updated = await db.get(`${LIST_SQL} WHERE c.id = ?`, [row.id]);
    res.json({ data: { classroom: serialize.classroom(updated) } });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM classrooms WHERE id = ?', [req.params.id]);
    requireRow(row, 'That classroom does not exist.');

    const children = await db.get(
      'SELECT COUNT(*) AS total FROM children WHERE classroom_id = ?',
      [row.id],
    );
    if (Number(children.total) > 0) {
      throw badRequest(
        'Move or archive the children of this classroom before deleting it.',
        'classroom_not_empty',
      );
    }

    await db.run('DELETE FROM classrooms WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, classroomId: Number(row.id) } });
  }),
);

module.exports = router;
