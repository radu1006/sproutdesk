'use strict';

/** Children (enrolment records) and their guardians (parent links). */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow, queryString, limitParam } = require('../lib/http');
const { nowIso, todayIso } = require('../lib/dates');
const { badRequest, conflict } = require('../lib/errors');
const access = require('../lib/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const ENROLLMENT_STATUSES = ['active', 'waitlist', 'archived'];
const RELATIONSHIPS = ['mother', 'father', 'guardian', 'other'];

const SELECT_CHILD = `
  SELECT ch.*,
         cl.name AS classroom_name,
         (SELECT COUNT(*) FROM guardians g WHERE g.child_id = ch.id) AS guardian_count
    FROM children ch
    LEFT JOIN classrooms cl ON cl.id = ch.classroom_id
`;

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ids = await access.accessibleChildIds(req.user);
    if (Array.isArray(ids) && ids.length === 0) {
      res.json({ data: [] });
      return;
    }

    const conditions = [];
    const params = [];

    if (Array.isArray(ids)) {
      conditions.push(`ch.id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }

    const classroomId = v.queryInteger(req.query, 'classroomId', { min: 1 });
    if (classroomId) {
      conditions.push('ch.classroom_id = ?');
      params.push(classroomId);
    }

    const status = queryString(req.query, 'status', req.user.role === 'parent' ? 'visible' : 'all');
    if (status !== 'all') {
      if (status === 'visible') {
        conditions.push(`ch.enrollment_status <> 'archived'`);
      } else {
        v.assert(ENROLLMENT_STATUSES.includes(status), 'Unknown enrolment status filter.');
        conditions.push('ch.enrollment_status = ?');
        params.push(status);
      }
    }

    const search = queryString(req.query, 'q');
    if (search) {
      conditions.push('(LOWER(ch.first_name) LIKE ? OR LOWER(ch.last_name) LIKE ?)');
      const term = `%${search.toLowerCase()}%`;
      params.push(term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(
      `${SELECT_CHILD} ${where} ORDER BY ch.first_name, ch.last_name LIMIT ?`,
      [...params, limitParam(req.query, { fallback: 200, max: 500 })],
    );
    res.json({ data: rows.map(serialize.child) });
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const firstName = v.text(req.body, 'firstName', { required: true, max: 60 });
    const lastName = v.text(req.body, 'lastName', { required: true, max: 60 });
    const dateOfBirth = v.dateOnly(req.body, 'dateOfBirth', { required: true });
    v.assert(dateOfBirth <= todayIso(), 'The date of birth cannot be in the future.');

    const classroomId = v.integer(req.body, 'classroomId', { min: 1 });
    if (classroomId) {
      const classroom = await db.get('SELECT id FROM classrooms WHERE id = ?', [classroomId]);
      if (!classroom) throw badRequest('The selected classroom does not exist.');
    }

    const enrollmentStatus =
      v.enum(req.body, 'enrollmentStatus', ENROLLMENT_STATUSES, { nullable: false }) ?? 'active';
    const startDate = v.dateOnly(req.body, 'startDate');
    const allergies = v.text(req.body, 'allergies', { max: 500 });
    const medicalNotes = v.text(req.body, 'medicalNotes', { max: 2000 });

    const now = nowIso();
    const { sql, params } = buildInsert('children', {
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dateOfBirth,
      classroom_id: classroomId ?? null,
      enrollment_status: enrollmentStatus,
      start_date: startDate ?? null,
      allergies: allergies ?? null,
      medical_notes: medicalNotes ?? null,
      created_at: now,
      updated_at: now,
    });
    const { id } = await db.run(sql, params);
    const row = await db.get(`${SELECT_CHILD} WHERE ch.id = ?`, [id]);
    res.status(201).json({ data: { child: serialize.child(row) } });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    await access.assertChildAccess(req.user, req.params.id);
    const row = await db.get(`${SELECT_CHILD} WHERE ch.id = ?`, [req.params.id]);
    requireRow(row, 'That child does not exist.');

    const guardians = await db.all(
      `SELECT g.*, u.full_name, u.email, u.phone
         FROM guardians g
         JOIN users u ON u.id = g.user_id
        WHERE g.child_id = ?
        ORDER BY g.is_primary_contact DESC, u.full_name`,
      [req.params.id],
    );

    res.json({
      data: { child: serialize.child(row), guardians: guardians.map(serialize.guardian) },
    });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    await access.assertChildAccess(req.user, req.params.id, { write: true });
    const isAdmin = req.user.role === 'admin';

    // Educators may only maintain the wellbeing fields of their own children.
    const patch = isAdmin
      ? {
          first_name: v.text(req.body, 'firstName', { max: 60 }),
          last_name: v.text(req.body, 'lastName', { max: 60 }),
          date_of_birth: v.dateOnly(req.body, 'dateOfBirth'),
          classroom_id: v.integer(req.body, 'classroomId', { min: 1 }),
          enrollment_status: v.enum(req.body, 'enrollmentStatus', ENROLLMENT_STATUSES, {
            nullable: false,
          }),
          start_date: v.dateOnly(req.body, 'startDate'),
          photo_url: v.text(req.body, 'photoUrl', { max: 500 }),
        }
      : {
          photo_url: v.text(req.body, 'photoUrl', { max: 500 }),
        };

    patch.allergies = v.text(req.body, 'allergies', { max: 500 });
    patch.medical_notes = v.text(req.body, 'medicalNotes', { max: 2000 });
    patch.updated_at = nowIso();

    const statement = buildUpdate('children', patch, 'id = ?', [req.params.id]);
    if (statement) await db.run(statement.sql, statement.params);

    const row = await db.get(`${SELECT_CHILD} WHERE ch.id = ?`, [req.params.id]);
    res.json({ data: { child: serialize.child(row) } });
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM children WHERE id = ?', [req.params.id]);
    requireRow(row, 'That child does not exist.');

    const invoices = await db.get('SELECT COUNT(*) AS total FROM invoices WHERE child_id = ?', [
      row.id,
    ]);
    if (Number(invoices.total) > 0) {
      throw badRequest(
        'This child has billing history. Archive the record instead of deleting it.',
        'child_has_invoices',
      );
    }

    await db.run('DELETE FROM children WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, childId: Number(row.id) } });
  }),
);

// --------------------------------------------------------------- guardians

router.get(
  '/:id/guardians',
  asyncHandler(async (req, res) => {
    await access.assertChildAccess(req.user, req.params.id);
    const rows = await db.all(
      `SELECT g.*, u.full_name, u.email, u.phone
         FROM guardians g
         JOIN users u ON u.id = g.user_id
        WHERE g.child_id = ?
        ORDER BY g.is_primary_contact DESC, u.full_name`,
      [req.params.id],
    );
    res.json({ data: rows.map(serialize.guardian) });
  }),
);

router.post(
  '/:id/guardians',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const child = await db.get('SELECT id FROM children WHERE id = ?', [req.params.id]);
    requireRow(child, 'That child does not exist.');

    const userId = v.integer(req.body, 'userId', { required: true, min: 1 });
    const user = await db.get('SELECT id, role FROM users WHERE id = ?', [userId]);
    if (!user) throw badRequest('The selected user does not exist.');
    if (user.role !== 'parent') {
      throw badRequest('Only accounts with the parent role can be linked as guardians.');
    }

    const relationship =
      v.enum(req.body, 'relationship', RELATIONSHIPS, { nullable: false }) ?? 'guardian';
    const isPrimaryContact = v.boolean(req.body, 'isPrimaryContact', { fallback: false });

    const existing = await db.get('SELECT id FROM guardians WHERE child_id = ? AND user_id = ?', [
      child.id,
      userId,
    ]);
    if (existing) throw conflict('That person is already linked to this child.');

    const { sql, params } = buildInsert('guardians', {
      child_id: child.id,
      user_id: userId,
      relationship,
      is_primary_contact: isPrimaryContact ? 1 : 0,
      created_at: nowIso(),
    });
    const { id } = await db.run(sql, params);
    const row = await db.get(
      `SELECT g.*, u.full_name, u.email, u.phone
         FROM guardians g JOIN users u ON u.id = g.user_id WHERE g.id = ?`,
      [id],
    );
    res.status(201).json({ data: { guardian: serialize.guardian(row) } });
  }),
);

router.delete(
  '/:id/guardians/:guardianId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM guardians WHERE id = ? AND child_id = ?', [
      req.params.guardianId,
      req.params.id,
    ]);
    requireRow(row, 'That guardian link does not exist.');
    await db.run('DELETE FROM guardians WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, guardianId: Number(row.id) } });
  }),
);

module.exports = router;
module.exports.ENROLLMENT_STATUSES = ENROLLMENT_STATUSES;
