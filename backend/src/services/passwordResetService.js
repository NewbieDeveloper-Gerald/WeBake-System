/**
 * Owner (admin) password reset via emailed link (spec Q8).
 *
 * WHAT: requestAdminReset mints a one-time token and emails the link;
 * confirmAdminReset redeems it for a new password.
 *
 * WHY tokens hash like passwords: the token IS a credential. Storing sha256
 * means a database leak does not hand out working reset links. The plain
 * token exists only inside the email URL. Responses never reveal whether the
 * email matched an admin (anti-enumeration).
 */

'use strict';

const crypto = require('crypto');
const config = require('../config/env');
const { query } = require('../config/db');
const { fail } = require('../utils/serviceError');
const { hashPassword } = require('../utils/password');
const mailer = require('./mailerService');

function sha256hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function requestAdminReset(email) {
  const clean = email.toLowerCase();
  const { rows } = await query('SELECT id FROM admins WHERE email = $1;', [clean]);

  // uniform response either way - but only a real admin gets an email.
  if (rows.length > 0) {
    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `UPDATE admins
          SET reset_token_hash = $1,
              reset_expires_at = NOW() + ($2 || ' minutes')::interval
        WHERE id = $3;`,
      [sha256hex(token), String(config.reset.tokenMinutes), rows[0].id]
    );
    // Contract: Phase 5 implements this admin page path.
    const url = `${config.cors.frontendUrl}/admin/html/reset.html?token=${token}`;
    mailer.bestEffort(
      mailer.sendAdminReset(clean, { url, minutes: config.reset.tokenMinutes }),
      `admin reset for ${clean}`
    );
  }
  return {
    message: 'If this email belongs to the owner account, a reset link is on its way.',
    message_en: 'If this email belongs to the owner account, a reset link is on its way.',
  };
}

async function confirmAdminReset(token, newPassword) {
  const { rows } = await query(
    `SELECT id FROM admins
      WHERE reset_token_hash = $1 AND reset_expires_at > NOW()
      LIMIT 1;`,
    [sha256hex(token)]
  );
  if (rows.length === 0) {
    throw fail(400, 'RESET_INVALID',
      'This reset link is invalid or expired. Please request a new one.');
  }
  const passwordHash = await hashPassword(newPassword);
  await query(
    `UPDATE admins
        SET password_hash = $1, reset_token_hash = NULL, reset_expires_at = NULL
      WHERE id = $2;`,
    [passwordHash, rows[0].id]
  );
  return true;
}

module.exports = { requestAdminReset, confirmAdminReset };
