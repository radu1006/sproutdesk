'use strict';

/**
 * Small typed error hierarchy. Anything thrown as an ApiError is turned into a
 * clean JSON response by src/middleware/error.js; anything else becomes a 500
 * with the details hidden from the client.
 */

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || ApiError.defaultCode(status);
  }

  static defaultCode(status) {
    switch (status) {
      case 400:
        return 'bad_request';
      case 401:
        return 'unauthenticated';
      case 403:
        return 'forbidden';
      case 404:
        return 'not_found';
      case 409:
        return 'conflict';
      case 413:
        return 'payload_too_large';
      default:
        return 'error';
    }
  }
}

const badRequest = (message, code) => new ApiError(400, message, code);
const unauthorized = (message = 'You need to sign in to continue.', code) =>
  new ApiError(401, message, code);
const forbidden = (message = 'You do not have access to this resource.', code) =>
  new ApiError(403, message, code);
const notFound = (message = 'Not found.', code) => new ApiError(404, message, code);
const conflict = (message, code) => new ApiError(409, message, code);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict };
