'use strict';

/** Class feed: photo/text updates posted to a classroom and read by parents. */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert, buildUpdate } = require('../lib/sql');
const { asyncHandler, requireRow, limitParam } = require('../lib/http');
const { nowIso } = require('../lib/dates');
const { badRequest } = require('../lib/errors');
const access = require('../lib/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const MEDIA_TYPES = ['none', 'image', 'video'];

const SELECT_POST = `
  SELECT p.*, cl.name AS classroom_name, u.full_name AS author_name
    FROM class_posts p
    LEFT JOIN classrooms cl ON cl.id = p.classroom_id
    LEFT JOIN users u ON u.id = p.author_id
`;

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];

    const ids = await access.visibleClassroomIds(req.user);
    if (Array.isArray(ids)) {
      if (ids.length === 0) {
        res.json({ data: [] });
        return;
      }
      conditions.push(`p.classroom_id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }

    const classroomId = v.queryInteger(req.query, 'classroomId', { min: 1 });
    if (classroomId) {
      await access.assertClassroomAccess(req.user, classroomId);
      conditions.push('p.classroom_id = ?');
      params.push(classroomId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.all(
      `${SELECT_POST} ${where} ORDER BY p.posted_at DESC, p.id DESC LIMIT ?`,
      [...params, limitParam(req.query, { fallback: 30, max: 100 })],
    );
    res.json({ data: rows.map(serialize.post) });
  }),
);

router.post(
  '/',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const classroomId = v.integer(req.body, 'classroomId', { required: true, min: 1 });
    await access.assertClassroomAccess(req.user, classroomId, { write: true });

    const title = v.text(req.body, 'title', { max: 140 });
    const body = v.text(req.body, 'body', { max: 4000 });
    const mediaUrl = v.text(req.body, 'mediaUrl', { max: 500 });
    const mediaType = v.enum(req.body, 'mediaType', MEDIA_TYPES, { nullable: false }) ?? 'none';

    v.assert(Boolean(body) || Boolean(mediaUrl), 'A post needs some text or a photo.');

    const now = nowIso();
    const { sql, params } = buildInsert('class_posts', {
      classroom_id: classroomId,
      author_id: req.user.id,
      title: title ?? null,
      body: body ?? null,
      media_url: mediaUrl ?? null,
      media_type: mediaType,
      posted_at: now,
      created_at: now,
      updated_at: now,
    });
    const { id } = await db.run(sql, params);
    const row = await db.get(`${SELECT_POST} WHERE p.id = ?`, [id]);
    res.status(201).json({ data: { post: serialize.post(row) } });
  }),
);

router.patch(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const post = await db.get('SELECT * FROM class_posts WHERE id = ?', [req.params.id]);
    requireRow(post, 'That post does not exist.');
    await access.assertClassroomAccess(req.user, post.classroom_id, { write: true });

    const mediaUrl = v.text(req.body, 'mediaUrl', { max: 500 });
    if (mediaUrl === null) throw badRequest('Use "mediaType": "none" to remove a photo.');

    const mediaType = v.enum(req.body, 'mediaType', MEDIA_TYPES, { nullable: false });
    const patch = {
      title: v.text(req.body, 'title', { max: 140 }),
      body: v.text(req.body, 'body', { max: 4000 }),
      media_url: mediaUrl,
      media_type: mediaType,
      updated_at: nowIso(),
    };
    if (mediaType === 'none') patch.media_url = null;

    const statement = buildUpdate('class_posts', patch, 'id = ?', [post.id]);
    if (statement) await db.run(statement.sql, statement.params);

    const row = await db.get(`${SELECT_POST} WHERE p.id = ?`, [post.id]);
    res.json({ data: { post: serialize.post(row) } });
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'teacher'),
  asyncHandler(async (req, res) => {
    const post = await db.get('SELECT * FROM class_posts WHERE id = ?', [req.params.id]);
    requireRow(post, 'That post does not exist.');
    await access.assertClassroomAccess(req.user, post.classroom_id, { write: true });
    await db.run('DELETE FROM class_posts WHERE id = ?', [post.id]);
    res.json({ data: { deleted: true, postId: Number(post.id) } });
  }),
);

module.exports = router;
module.exports.MEDIA_TYPES = MEDIA_TYPES;
