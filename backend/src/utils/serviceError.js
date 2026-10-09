/**
 * Service-layer error helper.
 *
 * WHAT: Builds Error objects carrying an HTTP status + code, which
 * the global errorHandler translates into the standard JSON body.
 */

'use strict';

function fail(status, code, message) {
  return Object.assign(new Error(message), { status, code, message, message_en: message });
}

const notFound = (message) => fail(404, 'NOT_FOUND', message);
const conflict = (code, message) => fail(409, code, message);

module.exports = { fail, notFound, conflict };
