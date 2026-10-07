/**
 * Async wrapper for route handlers.
 *
 * WHAT: Catches rejected promises from async controllers and forwards them to
 * the global error handler via next(err).
 *
 * WHY: Express 4 does NOT catch errors thrown inside async functions. Without
 * this, one forgotten try/catch crashes the request (or the process) with an
 * unhandled rejection. Wrapping every async handler once removes that risk.
 */

'use strict';

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
