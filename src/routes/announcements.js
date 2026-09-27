'use strict';

/**
 * Announcements: centre-wide or classroom notices, with per-user read
 * tracking so unread items can be highlighted in the top bar.
 */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow, limitParam } = require('../lib/http');
const { nowIso, todayIso } = require('../lib/dates');
const { badRequest, forbidden } = require('../lib/errors');
const access = require('../lib/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const AUDIENCES = ['all', 'teachers', 'parents'];

const SELECT_ANNOUNCEMENT = `
  SELECT a.*,
         cl.name AS classroom_name,
         u.full_name AS author_name,
         r.read_at AS is_read
    FROM announcements a
    LEFT JOIN classrooms cl ON cl.id = a.classroom_id
    LEFT JOIN users u ON u.id = a.author_id
    LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = ?
`;

router.use(requireAuth);

/** Extra WHERE fragment + params that hide announcements from a role. */
async function audienceScope(user) {
  if (user.role === 'admin') return { sql: '', params: [] };

  if (user.role === 'teacher') {
    const classroomIds = await access.teacherClassroomIds(user);
    if (classroomIds.length === 0) {
      return { sql: `a.audience IN ('all', 'teachers') AND a.classroom_id IS NULL`, params: [] };
    }
    const placeholders = classroomIds.map(() => '?').join(', ');
    return {
      sql: `(a.audience IN ('all', 'teachers') AND a.classroom_id IS NULL)
             OR a.classroom_id IN (${placeholders})`.replace(/\s+/g, ' '),
      params: classroomIds,
    };
  }

  const classroomIds = await access.visibleClassroomIds(user);
  if (Array.isArray(classroomIds) && classroomIds.length === 0) {
    return { sql: `a.audience IN ('all', 'parents') AND a.classroom_id IS NULL`, params: [] };
  }
  if (Array.isArray(classroomIds)) {
    const placeholders = classroomIds.map(() => '?').join(', ');
    return {
      sql: `a.audience IN ('all', 'parents')
            AND (a.classroom_id IS NULL OR a.classroom_id IN (${placeholders}))`.replace(/\s+/g, ' '),
      params: classroomIds,
    };
  }
  return { sql: `a.audience IN ('all', 'parents')`, params: [] };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [req.user.id];

    const scope = await audienceScope(req.user);
    if (scope.sql) {
      conditions.push(`(${scope.sql})`);
      params.push(...scope.params);
    }

    const classroomId = v.queryInteger(req.query, 'classroomId', { min: 1 });
    if (classroomId) {
      conditions.push('a.classroom_id = ?');
      params.push(classroomId);
    }

    if (v.boolean(req.query, 'active', { fallback: true })) {
      conditions.push('(a.expires_on IS NULL OR a.expires_on >= ?)');
      params.push(todayIso());
    }

    if (v.boolean(req.query, 'unreadOnly', { fallback: false })) {
      conditions.push('r.read_at IS NULL');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(
      `${SELECT_ANNOUNCEMENT} ${where} ORDER BY a.published_at DESC, a.id DESC LIMIT ?`,
      [...params, limitParam(req.query, { fallback: 40, max: 100 })],
    );
    res.json({ data: rows.map(serialize.announcement) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get(`${SELECT_ANNOUNCEMENT} WHERE a.id = ?`, [req.user.id, req.params.id]);
    requireRow(row, 'That announcement does not exist.');

    const canSeeAll = req.user.role === 'admin' || req.user.role === 'teacher';
    const data = { announcement: serialize.announcement(row) };

    if (canSeeAll) {
      const stats = await db.get(
        `SELECT COUNT(*) AS read_count,
                (SELECT COUNT(*) FROM users WHERE is_active = 1) AS user_count
           FROM announcement_reads WHERE announcement_id = ?`,
        [row.id],
      );
      data.readCount = Number(stats.read_count);
      data.userCount = Number(stats.user_count);
    }

    res.json({ data });
  }),
);

router.get(
  '/:id/reads',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const announcement = await db.get('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    requireRow(announcement, 'That announcement does not exist.');

    const rows = await db.all(
      `SELECT u.id AS user_id, u.full_name, u.role, r.read_at
         FROM announcement_reads r
         JOIN users u ON u.id = r.user_id
        WHERE r.announcement_id = ?
        ORDER BY r.read_at DESC`,
      [announcement.id],
    );
    res.json({
      data: rows.map((row) => ({
        userId: Number(row.user_id),
        fullName: row.full_name,
        role: row.role,
        readAt: row.read_at,
      })),
    });
  }),
);

router.post(
  '/',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const title = v.text(req.body, 'title', { required: true, max: 160 });
    const body = v.text(req.body, 'body', { required: true, max: 6000 });
    const audience = v.enum(req.body, 'audience', AUDIENCES, { nullable: false }) ?? 'all';
    const classroomId = v.integer(req.body, 'classroomId', { min: 1 });
    const expiresOn = v.dateOnly(req.body, 'expiresOn');
    const publishedAt = v.text(req.body, 'publishedAt', { max: 30 }) ?? nowIso();

    if (classroomId) {
      await access.assertClassroomAccess(req.user, classroomId, { write: true });
    } else if (req.user.role === 'teacher') {
      throw forbidden('Educators publish announcements to one of their classrooms.');
    }
    if (expiresOn && expiresOn < todayIso()) {
      throw badRequest('The expiry date cannot be in the past.');
    }

    const now = nowIso();
    const { sql, params } = buildInsert('announcements', {
      title,
      body,
      audience,
      classroom_id: classroomId ?? null,
      author_id: req.user.id,
      published_at: publishedAt,
      expires_on: expiresOn ?? null,
      created_at: now,
      updated_at: now,
    });
    const { id } = await db.run(sql, params);
    const row = await db.get(`${SELECT_ANNOUNCEMENT} WHERE a.id = ?`, [req.user.id, id]);
    res.status(201).json({ data: { announcement: serialize.announcement(row) } });
  }),
);

/** Authors edit their own announcements, administrators edit any. */
async function loadEditable(req) {
  const row = await db.get('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
  requireRow(row, 'That announcement does not exist.');
  if (req.user.role !== 'admin' && Number(row.author_id) !== Number(req.user.id)) {
    throw forbidden('You can only change announcements you published yourself.');
  }
  return row;
}

router.patch(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const row = await loadEditable(req);

    const patch = {
      title: v.text(req.body, 'title', { max: 160 }),
      body: v.text(req.body, 'body', { max: 6000 }),
      audience: v.enum(req.body, 'audience', AUDIENCES, { nullable: false }),
      expires_on: v.dateOnly(req.body, 'expiresOn'),
      published_at: v.text(req.body, 'publishedAt', { max: 30 }),
      updated_at: nowIso(),
    };

    if (req.body.classroomId !== undefined) {
      const classroomId = v.integer(req.body, 'classroomId', { min: 1 });
      if (classroomId) await access.assertClassroomAccess(req.user, classroomId, { write: true });
      patch.classroom_id = classroomId ?? null;
    }

    const statement = buildUpdate('announcements', patch, 'id = ?', [row.id]);
    if (statement) await db.run(statement.sql, statement.params);

    const updated = await db.get(`${SELECT_ANNOUNCEMENT} WHERE a.id = ?`, [req.user.id, row.id]);
    res.json({ data: { announcement: serialize.announcement(updated) } });
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const row = await loadEditable(req);
    await db.run('DELETE FROM announcements WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, announcementId: Number(row.id) } });
  }),
);

/** Idempotent: marking something read twice keeps the first timestamp. */
router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    requireRow(row, 'That announcement does not exist.');

    const existing = await db.get(
      'SELECT * FROM announcement_reads WHERE announcement_id = ? AND user_id = ?',
      [row.id, req.user.id],
    );
    if (existing) {
      res.json({ data: { read: true, readAt: existing.read_at } });
      return;
    }

    const readAt = nowIso();
    const { sql, params } = buildInsert('announcement_reads', {
      announcement_id: row.id,
      user_id: req.user.id,
      read_at: readAt,
    });
    await db.run(sql, params);
    res.json({ data: { read: true, readAt } });
  }),
);

// __APPEND_ANNOUNCEMENTS__

module.exports = router;
module.exports.AUDIENCES = AUDIENCES;
