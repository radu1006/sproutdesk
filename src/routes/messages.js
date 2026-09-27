'use strict';

/**
 * Direct messages between staff and families.
 *
 * A conversation ("thread") is identified by the two participant ids sorted
 * ascending, e.g. `3-8`, so a single row per message is enough - no separate
 * thread table and no duplicated copies of the same text.
 */

const express = require('express');
const db = require('../db');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { buildInsert } = require('../lib/sql');
const { asyncHandler, requireRow } = require('../lib/http');
const { nowIso } = require('../lib/dates');
const { forbidden } = require('../lib/errors');
const access = require('../lib/access');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const threadKey = (a, b) => [Number(a), Number(b)].sort((x, y) => x - y).join('-');

const SELECT_MESSAGE = `
  SELECT m.*, s.full_name AS sender_name, r.full_name AS recipient_name
    FROM messages m
    LEFT JOIN users s ON s.id = m.sender_id
    LEFT JOIN users r ON r.id = m.recipient_id
`;

/** Everyone in the conversation must be one of the two participants. */
function isParticipant(user, row) {
  return (
    Number(row.sender_id) === Number(user.id) || Number(row.recipient_id) === Number(user.id)
  );
}

router.get(
  '/contacts',
  asyncHandler(async (req, res) => {
    const rows = await access.messageContacts(req.user);
    res.json({
      data: rows.map((row) => ({
        id: Number(row.id),
        fullName: row.full_name,
        role: row.role,
        email: row.email,
      })),
    });
  }),
);

/** Conversation list: one entry per person, with unread counts. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `${SELECT_MESSAGE}
        WHERE m.sender_id = ? OR m.recipient_id = ?
        ORDER BY m.sent_at DESC, m.id DESC
        LIMIT 500`,
      [req.user.id, req.user.id],
    );

    const threads = new Map();
    for (const row of rows) {
      const partnerId =
        Number(row.sender_id) === Number(req.user.id) ? row.recipient_id : row.sender_id;
      const key = threadKey(req.user.id, partnerId);
      const unread = Number(row.recipient_id) === Number(req.user.id) && !row.read_at;

      if (!threads.has(key)) {
        threads.set(key, {
          threadKey: key,
          partnerId: Number(partnerId),
          partnerName:
            Number(row.sender_id) === Number(req.user.id) ? row.recipient_name : row.sender_name,
          lastMessageAt: row.sent_at,
          lastMessagePreview: String(row.body || '').slice(0, 140),
          lastMessageFromMe: Number(row.sender_id) === Number(req.user.id),
          unreadCount: 0,
        });
      }
      if (unread) threads.get(key).unreadCount += 1;
    }

    res.json({ data: [...threads.values()] });
  }),
);

router.get(
  '/unread',
  asyncHandler(async (req, res) => {
    const row = await db.get(
      'SELECT COUNT(*) AS total FROM messages WHERE recipient_id = ? AND read_at IS NULL',
      [req.user.id],
    );
    res.json({ data: { unread: Number(row.total) } });
  }),
);

router.get(
  '/thread/:userId',
  asyncHandler(async (req, res) => {
    const partnerId = v.integer(req.params, 'userId', { required: true, min: 1 });
    const partner = await db.get('SELECT id, full_name, role, email FROM users WHERE id = ?', [
      partnerId,
    ]);
    requireRow(partner, 'That person does not exist.');
    if (!(await access.canMessage(req.user, partnerId))) {
      throw forbidden('You cannot start a conversation with that person.');
    }

    const key = threadKey(req.user.id, partnerId);
    const rows = await db.all(
      `${SELECT_MESSAGE} WHERE m.thread_key = ? ORDER BY m.sent_at, m.id LIMIT 500`,
      [key],
    );

    // Everything addressed to me in this thread counts as read from now on.
    await db.run(
      `UPDATE messages SET read_at = ? WHERE thread_key = ? AND recipient_id = ? AND read_at IS NULL`,
      [nowIso(), key, req.user.id],
    );

    res.json({
      data: {
        partner: {
          id: Number(partner.id),
          fullName: partner.full_name,
          role: partner.role,
          email: partner.email,
        },
        messages: rows.map(serialize.message),
      },
    });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const recipientId = v.integer(req.body, 'recipientId', { required: true, min: 1 });
    const body = v.text(req.body, 'body', { required: true, max: 4000 });
    const subject = v.text(req.body, 'subject', { max: 160 });
    const childId = v.integer(req.body, 'childId', { min: 1 });

    if (Number(recipientId) === Number(req.user.id)) {
      throw forbidden('You cannot send a message to yourself.');
    }
    const recipient = await db.get('SELECT id, is_active FROM users WHERE id = ?', [recipientId]);
    requireRow(recipient, 'That person does not exist.');
    if (!(recipient.is_active === 1 || recipient.is_active === true)) {
      throw forbidden('That account is deactivated.');
    }
    if (!(await access.canMessage(req.user, recipientId))) {
      throw forbidden('You cannot start a conversation with that person.');
    }
    if (childId) await access.assertChildAccess(req.user, childId);

    const { sql, params } = buildInsert('messages', {
      thread_key: threadKey(req.user.id, recipientId),
      sender_id: req.user.id,
      recipient_id: recipientId,
      child_id: childId ?? null,
      subject: subject ?? null,
      body,
      sent_at: nowIso(),
      created_at: nowIso(),
    });
    const { id } = await db.run(sql, params);
    const row = await db.get(`${SELECT_MESSAGE} WHERE m.id = ?`, [id]);
    res.status(201).json({ data: { message: serialize.message(row) } });
  }),
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    requireRow(row, 'That message does not exist.');
    if (!isParticipant(req.user, row)) throw forbidden('That message is not yours.');
    if (row.read_at) {
      res.json({ data: { read: true, readAt: row.read_at } });
      return;
    }
    const readAt = nowIso();
    await db.run('UPDATE messages SET read_at = ? WHERE id = ?', [readAt, row.id]);
    res.json({ data: { read: true, readAt } });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    requireRow(row, 'That message does not exist.');
    if (!isParticipant(req.user, row)) throw forbidden('That message is not yours.');
    await db.run('DELETE FROM messages WHERE id = ?', [row.id]);
    res.json({ data: { deleted: true, messageId: Number(row.id) } });
  }),
);

module.exports = router;
module.exports.threadKey = threadKey;
