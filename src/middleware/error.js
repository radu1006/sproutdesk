'use strict';

/** 404 handler for unmatched API routes + central error formatter. */

const { ApiError } = require('../lib/errors');

function apiNotFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: { message: `Unknown endpoint: ${req.method} ${req.path}`, code: 'not_found' },
    });
  }
  return next();
}

/** Translates driver specific errors into friendly HTTP responses. */
function normaliseError(error) {
  if (error instanceof ApiError) return error;

  const message = String(error?.message || '');

  // SQLite: UNIQUE constraint failed: users.email
  if (/UNIQUE constraint failed/i.test(message)) {
    return new ApiError(409, 'That value is already in use.', 'conflict');
  }
  // MySQL-style / generic duplicate key
  if (error?.code === '23505') {
    return new ApiError(409, 'That value is already in use.', 'conflict');
  }
  // PostgreSQL CHECK / NOT NULL violations
  if (error?.code === '23514' || error?.code === '23502') {
    return new ApiError(400, 'Some of the submitted values are not allowed.', 'invalid_value');
  }
  // Foreign key violations
  if (error?.code === '23503' || /FOREIGN KEY constraint failed/i.test(message)) {
    return new ApiError(409, 'A related record is missing or still referenced.', 'conflict');
  }
  // multer upload errors
  if (error?.name === 'MulterError') {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new ApiError(413, 'That file is larger than the allowed upload size.', 'file_too_large');
    }
    return new ApiError(400, `Upload rejected: ${error.message}`, 'upload_error');
  }
  // express.json() / express.urlencoded() body size limit (1mb in server.js)
  if (error?.type === 'entity.too.large' || error?.status === 413 || error?.statusCode === 413) {
    return new ApiError(413, 'The request body is larger than the allowed size.', 'payload_too_large');
  }
  // express.json() body parsing
  if (error instanceof SyntaxError && 'body' in error) {
    return new ApiError(400, 'The request body is not valid JSON.', 'invalid_json');
  }

  return new ApiError(500, 'Something went wrong on the server.', 'internal_error');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  const normalised = normaliseError(error);

  if (normalised.status >= 500) {
    console.error('[error]', error);
  } else if (process.env.NODE_ENV !== 'production' && process.env.LOG_LEVEL === 'debug') {
    console.warn('[warn]', normalised.message);
  }

  if (res.headersSent) return res.end();
  return res.status(normalised.status).json({
    error: { message: normalised.message, code: normalised.code },
  });
}

module.exports = { apiNotFound, errorHandler, normaliseError };
