'use strict';

/**
 * Error plumbing: the ApiError class, the shared HTTP helpers and the mapping
 * from driver/multipart failures to the codes documented in docs/API.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
} = require('../src/lib/errors');
const { asyncHandler, queryString, requireRow, limitParam } = require('../src/lib/http');
const { normaliseError } = require('../src/middleware/error');

test('ApiError derives a default code from its status', () => {
  assert.equal(badRequest('nope').status, 400);
  assert.equal(badRequest('nope').code, 'bad_request');
  assert.equal(unauthorized().status, 401);
  assert.equal(unauthorized().code, 'unauthenticated');
  assert.equal(forbidden().status, 403);
  assert.equal(forbidden().code, 'forbidden');
  assert.equal(notFound().status, 404);
  assert.equal(conflict('already used').code, 'conflict');
  assert.equal(new ApiError(413, 'too big').code, 'payload_too_large');
  assert.equal(new ApiError(418, 'teapot').code, 'error');
});

test('an explicit code always wins', () => {
  const error = badRequest('That child has billing history.', 'child_has_invoices');
  assert.equal(error.code, 'child_has_invoices');
  assert.equal(error.message, 'That child has billing history.');
  assert.equal(error.status, 400);
  assert.ok(error instanceof Error);
});

test('normaliseError translates conflicts', () => {
  const unique = normaliseError(new Error('UNIQUE constraint failed: users.email'));
  assert.equal(unique.status, 409);
  assert.equal(unique.code, 'conflict');

  const foreignKey = normaliseError({ code: '23503', message: 'update violates foreign key' });
  assert.equal(foreignKey.status, 409);
  assert.equal(foreignKey.code, 'conflict');

  const duplicate = normaliseError({ code: '23505', message: 'duplicate key value' });
  assert.equal(duplicate.status, 409);
});

test('normaliseError translates invalid values', () => {
  const check = normaliseError({ code: '23514', message: 'new row violates check constraint' });
  assert.equal(check.status, 400);
  assert.equal(check.code, 'invalid_value');

  // PostgreSQL NOT NULL violations are reported the same way.
  const notNull = normaliseError({ code: '23502', message: 'null value in column' });
  assert.equal(notNull.status, 400);
  assert.equal(notNull.code, 'invalid_value');
});

test('normaliseError translates upload failures', () => {
  const tooLarge = normaliseError({ name: 'MulterError', code: 'LIMIT_FILE_SIZE', message: 'File too large' });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.code, 'file_too_large');

  const unexpected = normaliseError({ name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE', message: 'Unexpected field' });
  assert.equal(unexpected.status, 400);
  assert.equal(unexpected.code, 'upload_error');
});

test('normaliseError translates malformed JSON bodies', () => {
  const error = Object.assign(new SyntaxError('Unexpected token'), { body: {} });
  const mapped = normaliseError(error);
  assert.equal(mapped.status, 400);
  assert.equal(mapped.code, 'invalid_json');
});

test('normaliseError translates oversized request bodies', () => {
  // express.json() / express.urlencoded() hit their 1mb limit.
  const tooLarge = normaliseError({
    type: 'entity.too.large',
    status: 413,
    message: 'request entity too large',
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.code, 'payload_too_large');

  // http-errors based middleware reports the same failure through `statusCode`.
  const bare = normaliseError({ statusCode: 413, message: 'too large' });
  assert.equal(bare.status, 413);
  assert.equal(bare.code, 'payload_too_large');
});

test('normaliseError keeps ApiErrors and hides unexpected failures', () => {
  const apiError = notFound('That invoice does not exist.');
  assert.equal(normaliseError(apiError), apiError);

  const unknown = normaliseError(new Error('boom'));
  assert.equal(unknown.status, 500);
  assert.equal(unknown.code, 'internal_error');
  assert.equal(unknown.message, 'Something went wrong on the server.');
});

test('requireRow turns a missing row into a 404', () => {
  assert.deepEqual(requireRow({ id: 1 }), { id: 1 });
  assert.throws(() => requireRow(null, 'That payment does not exist.'), (error) => {
    assert.equal(error.status, 404);
    assert.equal(error.code, 'not_found');
    assert.equal(error.message, 'That payment does not exist.');
    return true;
  });
});

test('queryString keeps filters tidy', () => {
  assert.equal(queryString({ q: 'amy' }, 'q'), 'amy');
  assert.equal(queryString({ q: '' }, 'q', 'all'), 'all');
  assert.equal(queryString({ q: undefined }, 'q', 'all'), 'all');
  assert.equal(queryString({}, 'q', 'all'), 'all');
  assert.equal(queryString(undefined, 'q', 'all'), 'all');
  assert.equal(queryString({ limit: 20 }, 'limit'), '20');
});

test('limitParam clamps whatever the client asks for', () => {
  const options = { fallback: 40, max: 100 };
  assert.equal(limitParam({}, options), 40);
  assert.equal(limitParam({ limit: '25' }, options), 25);
  assert.equal(limitParam({ limit: '5000' }, options), 100);
  assert.equal(limitParam({ limit: '0' }, options), 40);
  assert.equal(limitParam({ limit: '-3' }, options), 40);
  assert.equal(limitParam({ limit: 'abc' }, options), 40);
});

test('asyncHandler forwards rejections to the next middleware', async () => {
  const seen = [];
  const handler = asyncHandler(async () => {
    throw new Error('boom');
  });
  await new Promise((resolve) => {
    handler({}, {}, (error) => {
      seen.push(error);
      resolve();
    });
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].message, 'boom');
});

test('asyncHandler leaves successful handlers alone', async () => {
  const handler = asyncHandler(async (req, res, next) => {
    res.statusCode = 204;
    next();
  });
  const res = {};
  await new Promise((resolve) => {
    handler({}, res, () => resolve());
  });
  assert.equal(res.statusCode, 204);
});
