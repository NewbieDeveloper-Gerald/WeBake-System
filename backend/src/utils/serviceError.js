/**
 * Service-layer error helper.
 *
 * WHAT: Builds bilingual Error objects carrying an HTTP status + code, which
 * the global errorHandler translates into the standard JSON body.
 *
 * WHY: services must not know about req/res, but they DO know why an action
 * failed ("order not found" vs "already in production"). Throwing a fail()
 * error keeps controllers thin - they just let it bubble to errorHandler.
 */

'use strict';

function fail(status, code, message_en, message_fil) {
  return Object.assign(new Error(message_en), { status, code, message_en, message_fil });
}

const notFound = (en, fil) => fail(404, 'NOT_FOUND', en, fil);
const conflict = (code, en, fil) => fail(409, code, en, fil);

module.exports = { fail, notFound, conflict };
