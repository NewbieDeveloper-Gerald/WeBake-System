/**
 * Global error handling: 404 catcher + final error middleware.
 *
 * WHAT: Guarantees EVERY response (success or failure) leaves the API as JSON
 * in one predictable shape, and that stack traces never leak to browsers.
 */

'use strict';

const config = require('../config/env');

/** Catches requests that matched no route. Must be mounted AFTER all routes. */
function notFound(req, res) {
  return res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'The requested resource was not found.',
    message_en: 'The requested resource was not found.',
  });
}

/**
 * Final error middleware. Express recognizes it by the 4-argument signature
 * (err, req, res, next) - do not remove `next` even though it is unused.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error('[api] unhandled error:', err);

  if (err.message && err.message.startsWith('CORS blocked')) {
    return res.status(403).json({
      success: false,
      code: 'CORS_BLOCKED',
      message: 'This origin is not allowed to call the API.',
      message_en: 'This origin is not allowed to call the API.',
    });
  }

  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  const code = status === 500 ? 'SERVER_ERROR' : (err.code || 'SERVER_ERROR');
  const message = status === 500
    ? 'An unexpected error occurred. Please try again.'
    : (err.message || err.message_en || 'Request failed.');

  return res.status(status).json({
    success: false,
    code,
    ...(status !== 500 && err.details ? { details: err.details } : {}),
    ...(status !== 500 && err.retryAfter ? { retryAfter: err.retryAfter } : {}),
    message,
    message_en: message,
    ...(config.nodeEnv !== 'production' && err.stack ? { stack: err.stack } : {}),
  });
}

module.exports = { notFound, errorHandler };
