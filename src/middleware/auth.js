'use strict';

/**
 * Authenticated request middleware. `attachUser` runs on every request and
 * makes `req.user` available when a valid session cookie is present;
 * `requireAuth` / `requireRole` guard the protected routes.
 */

const sessions = require('../lib/sessions');
const { asyncHandler } = require('../lib/http');
const { unauthorized, forbidden } = require('../lib/errors');

const attachUser = asyncHandler(async (req, res, next) => {
  const token = sessions.readToken(req);
  req.sessionToken = token;
  if (token) {
    const resolved = await sessions.resolveSession(token);
    if (resolved) {
      req.user = resolved.user;
      req.sessionExpiresAt = resolved.expiresAt;
    }
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  return next();
}

function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(
        forbidden(`This action is limited to: ${roles.join(', ')}.`, 'insufficient_role'),
      );
    }
    return next();
  };
}

module.exports = { attachUser, requireAuth, requireRole };
