'use strict';

/** Authentication: sign in, sign out, current user, own profile. */

const express = require('express');
const db = require('../db');
const sessions = require('../lib/sessions');
const serialize = require('../lib/serialize');
const v = require('../lib/validate');
const { asyncHandler } = require('../lib/http');
const { nowIso } = require('../lib/dates');
const { unauthorized, badRequest } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function schoolSettings() {
  const rows = await db.all('SELECT key, value FROM settings ORDER BY key');
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = v.email(req.body, 'email', { required: true });
    const password = v.text(req.body, 'password', { required: true, max: 200, trim: false });

    const row = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    const passwordOk = row ? await v.verifyPassword(password, row.password_hash) : false;
    if (!row || !passwordOk) {
      // Same message for unknown email and wrong password: no account probing.
      throw unauthorized('Email address or password is incorrect.', 'invalid_credentials');
    }
    if (!(row.is_active === 1 || row.is_active === true)) {
      throw unauthorized('This account has been deactivated.', 'account_disabled');
    }

    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), row.id]);
    const session = await sessions.createSession(row.id, req, res);
    await sessions.purgeExpired();

    res.json({
      data: {
        user: serialize.user({ ...row, last_login_at: nowIso() }),
        sessionExpiresAt: session.expiresAt,
        school: await schoolSettings(),
      },
    });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await sessions.destroySession(req.sessionToken);
    sessions.clearCookie(res);
    res.json({ data: { signedOut: true } });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      data: { user: req.user, sessionExpiresAt: req.sessionExpiresAt, school: await schoolSettings() },
    });
  }),
);

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const fullName = v.text(req.body, 'fullName', { required: true, max: 120 });
    const phone = v.text(req.body, 'phone', { max: 40 });
    const jobTitle = v.text(req.body, 'jobTitle', { max: 120 });

    await db.run(
      `UPDATE users SET full_name = ?, phone = ?, job_title = ?, updated_at = ? WHERE id = ?`,
      [
        fullName,
        phone === undefined ? req.user.phone : phone,
        jobTitle === undefined ? req.user.jobTitle : jobTitle,
        nowIso(),
        req.user.id,
      ],
    );
    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ data: { user: serialize.user(row) } });
  }),
);

router.post(
  '/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const currentPassword = v.text(req.body, 'currentPassword', {
      required: true,
      max: 200,
      trim: false,
    });
    const newPassword = v.text(req.body, 'newPassword', { required: true, max: 200, trim: false });

    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!(await v.verifyPassword(currentPassword, row.password_hash))) {
      throw badRequest('The current password is not correct.', 'invalid_password');
    }
    if (currentPassword === newPassword) {
      throw badRequest('The new password must be different from the current one.');
    }

    const hash = await v.hashPassword(newPassword);
    await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
      hash,
      nowIso(),
      req.user.id,
    ]);
    // Other sessions are dropped, the current one stays valid.
    const keep = req.sessionToken;
    await db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [req.user.id, keep]);

    res.json({ data: { updated: true } });
  }),
);

module.exports = router;
module.exports.schoolSettings = schoolSettings;
