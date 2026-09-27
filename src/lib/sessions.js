'use strict';

/**
 * Server side sessions.
 *
 * A random 32 byte token is stored in the `sessions` table and handed to the
 * browser as an HttpOnly cookie. The cookie itself carries no user data, so a
 * logout (or an administrator deactivating an account) invalidates access
 * immediately - unlike a self contained JWT.
 */

const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { nowIso } = require('./dates');

const COOKIE_NAME = config.session.cookieName;

/** Minimal cookie header parser (avoids an extra dependency). */
function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      jar[name] = decodeURIComponent(value);
    } catch {
      jar[name] = value;
    }
  }
  return jar;
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'strict', // blocks cross-site request forgery from other origins
    secure: config.isProduction,
    path: '/',
    maxAge: maxAgeMs,
  };
}

async function createSession(userId, req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttlMs = config.session.ttlHours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  await db.run(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      token,
      userId,
      nowIso(),
      expiresAt,
      (req.headers['user-agent'] || '').slice(0, 250),
      (req.ip || '').slice(0, 60),
    ],
  );

  res.cookie(COOKIE_NAME, token, cookieOptions(ttlMs));
  return { token, expiresAt };
}

function readToken(req) {
  const jar = parseCookies(req.headers.cookie);
  return jar[COOKIE_NAME] || null;
}

/** Returns `{ session, user }` for a valid cookie, otherwise null. */
async function resolveSession(token) {
  if (!token) return null;
  const row = await db.get(
    `SELECT s.id AS session_id, s.expires_at, u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [token],
  );
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    await destroySession(token);
    return null;
  }
  if (row.is_active !== 1 && row.is_active !== true) return null;

  const user = {
    id: Number(row.id),
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    phone: row.phone,
    jobTitle: row.job_title,
    isActive: row.is_active === 1 || row.is_active === true,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
  return { user, expiresAt: row.expires_at };
}

async function destroySession(token) {
  if (!token) return;
  await db.run('DELETE FROM sessions WHERE id = ?', [token]);
}

async function destroyUserSessions(userId) {
  await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

async function purgeExpired() {
  const result = await db.run('DELETE FROM sessions WHERE expires_at <= ?', [nowIso()]);
  return result.changes;
}

function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  createSession,
  readToken,
  resolveSession,
  destroySession,
  destroyUserSessions,
  purgeExpired,
  clearCookie,
};
