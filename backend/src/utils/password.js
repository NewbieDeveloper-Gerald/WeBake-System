/**
 * Password hashing with bcrypt.
 *
 * WHAT: hashPassword() turns a plain password into a salted hash for storage;
 * verifyPassword() checks a login attempt against the stored hash.
 *
 * WHY bcrypt: it is deliberately SLOW (cost factor 2^rounds). Attackers who
 * steal the database must pay that cost per guess, per password. bcryptjs is
 * the pure-JavaScript build, so Render installs it with no native compiler.
 *
 * RULE: plain passwords exist only in memory during the request. They are
 * never logged, never stored, never returned in any response.
 */

'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config/env');

/**
 * Hash a new password. Each call generates a fresh random salt, so identical
 * passwords produce different hashes (rainbow tables become useless).
 */
async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }
  return bcrypt.hash(plainPassword, config.auth.bcryptRounds);
}

/**
 * Compare a login attempt to the stored hash. Returns true/false, never throws
 * on mismatch. bcrypt.compare is timing-safe, so response time does not leak
 * how close a wrong guess was.
 */
async function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash) return false;
  try {
    return await bcrypt.compare(plainPassword, storedHash);
  } catch {
    // Malformed hash in DB: treat as "wrong password", do not crash login.
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
