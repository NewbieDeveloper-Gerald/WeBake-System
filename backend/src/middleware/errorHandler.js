/**
 * Global error handling: 404 catcher + final error middleware.
 *
 * WHAT: Guarantees EVERY response (success or failure) leaves the API as JSON
 * in one predictable shape, and that stack traces never leak to browsers.
 *
 * WHY: Express's default error page is HTML. A JSON API returning HTML on
 * crashes breaks frontend parsing and can expose file paths, SQL, or secrets
 * in stack traces. This file is the last line of defense.
 */

'use strict';

const config = require('../config/env');

/** Catches requests that matched no route. Must be mounted AFTER all routes. */
function notFound(req, res) {
  return res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message_en: 'The requested resource was not found.',
    message_fil: 'Hindi nahanap ang hiniling na resource.',
  });
}

/**
 * Final error middleware. Express recognizes it by the 4-argument signature
 * (err, req, res, next) - do not remove `next` even though it is unused.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Log the full error server-side (Render logs), where developers can see it.
  console.error('[api] unhandled error:', err);

  // The cors package forwards blocked origins here as plain Errors. Translate
  // to 403 (not 500): a rejected origin is a policy decision, not a crash.
  if (err.message && err.message.startsWith('CORS blocked')) {
    return res.status(403).json({
      success: false,
      code: 'CORS_BLOCKED',
      message_en: 'This origin is not allowed to call the API.',
      message_fil: 'Hindi pinapayagang tumawag sa API ang origin na ito.',
    });
  }

  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  // On 500s the code is forced generic: driver codes (ECONNREFUSED, 23505)
  // would otherwise leak infrastructure details to browsers.
  const code = status === 500 ? 'SERVER_ERROR' : (err.code || 'SERVER_ERROR');
  return res.status(status).json({
    success: false,
    code,
    // Opt-in extras: rate-limit retry hints and structured conflict details
    // (e.g. per-product stock shortages). Only services set these, and only
    // on non-500 responses, so nothing internal ever leaks.
    ...(status !== 500 && err.details ? { details: err.details } : {}),
    ...(status !== 500 && err.retryAfter ? { retryAfter: err.retryAfter } : {}),
    message_en: status === 500
      ? 'An unexpected error occurred. Please try again.'
      : (err.message_en || err.message || 'Request failed.'),
    message_fil: status === 500
      ? 'May hindi inaasahang error. Pakisubukang muli.'
      : (err.message_fil || 'Nabigo ang kahilingan.'),
    // Stack traces only in development - never in production responses.
    ...(config.nodeEnv !== 'production' && err.stack ? { stack: err.stack } : {}),
  });
}

module.exports = { notFound, errorHandler };
