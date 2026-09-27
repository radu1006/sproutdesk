'use strict';

/** Staff and parent account management (administrators only). */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow, queryString } = require('../lib/http');
const { nowIso } = require('../lib/dates');
const { badRequest, conflict } = require('../lib/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const sessions = require('../lib/sessions');

const router = express.Router();
const ROLES = ['admin', 'teacher', 'parent'];

router.use(requireAuth, requireRole('admin'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const role = queryString(req.query, 'role');
    const search = queryString(req.query, 'q');
    const conditions = [];
    const params = [];

    if (role) {
      v.assert(ROLES.includes(role), 'Unknown role filter.');
      conditions.push('role = ?');
      params.push(role);
    }
    if (search) {
      conditions.push('(LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)');
      params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT * FROM users ${where} ORDER BY role, full_name`,
      params,
    );
    res.json({ data: rows.map(serialize.user) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const fullName = v.text(req.body, 'fullName', { required: true, max: 120 });
    const email = v.email(req.body, 'email', { required: true });
    const role = v.enum(req.body, 'role', ROLES, { required: true, nullable: false });
    const password = v.text(req.body, 'password', { required: true, max: 200, trim: false });
    const phone = v.text(req.body, 'phone', { max: 40 });
    const jobTitle = v.text(req.body, 'jobTitle', { max: 120 });

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) throw conflict('An account with that email address already exists.');

    const now = nowIso();
    const { sql, params } = buildInsert('users', {
      email,
      password_hash: await v.hashPassword(password),
      full_name: fullName,
      role,
      phone: phone ?? null,
      job_title: jobTitle ?? null,
      is_active: 1,
      created_at: now,
      updated_at: now,
    });
    const { id } = await db.run(sql, params);
    const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    res.status(201).json({ data: { user: serialize.user(row) } });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    requireRow(row, 'That user does not exist.');
    res.json({ data: { user: serialize.user(row) } });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    requireRow(row, 'That user does not exist.');

    const fullName = v.text(req.body, 'fullName', { max: 120 });
    const email = v.email(req.body, 'email');
    const role = v.enum(req.body, 'role', ROLES, { nullable: false });
    const phone = v.text(req.body, 'phone', { max: 40 });
    const jobTitle = v.text(req.body, 'jobTitle', { max: 120 });
    const isActive = v.boolean(req.body, 'isActive');
    const password = v.text(req.body, 'password', { max: 200, trim: false });

    if (email && email !== row.email) {
      const clash = await db.get('SELECT id FROM users WHERE email = ? AND id <> ?', [email, row.id]);
      if (clash) throw conflict('Another account already uses that email address.');
    }
    if (role && role !== 'admin') {
      const admins = await db.get(
        `SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?`,
        [row.id],
      );
      if (Number(admins.total) === 0) {
        throw badRequest('The last active administrator cannot lose the admin role.');
      }
    }
    if (isActive === false && Number(row.id) === Number(req.user.id)) {
      throw badRequest('You cannot deactivate your own account.');
    }

    const patch = {
      full_name: fullName,
      email,
      role,
      phone,
      job_title: jobTitle,
      is_active: isActive === undefined ? undefined : isActive ? 1 : 0,
      password_hash: password ? await v.hashPassword(password) : undefined,
      updated_at: nowIso(),
    };
    const statement = buildUpdate('users', patch, 'id = ?', [row.id]);
    await db.run(statement.sql, statement.params);

    if (patch.is_active === 0 || password) {
      await sessions.destroyUserSessions(row.id);
    }

    const updated = await db.get('SELECT * FROM users WHERE id = ?', [row.id]);
    res.json({ data: { user: serialize.user(updated) } });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    requireRow(row, 'That user does not exist.');
    if (Number(row.id) === Number(req.user.id)) {
      throw badRequest('You cannot delete your own account.');
    }

    // Accounts are deactivated rather than deleted so that historical records
    // (attendance, reports, invoices) keep their author reference.
    await db.run('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), row.id]);
    await sessions.destroyUserSessions(row.id);
    res.json({ data: { deactivated: true, userId: Number(row.id) } });
  }),
);

module.exports = router;
