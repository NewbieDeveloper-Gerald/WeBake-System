/**
 * OTP service: database-backed 6-digit email verification.
 *
 * WHAT: requestCode (generate + store hash + email), verifyCode (check +
 * single-use stamp), consumeVerification (atomic claim inside order/register
 * transactions).
 *
 * SECURITY RULES:
 * 1. Only the SHA-256 HASH is stored. A database leak reveals no usable codes.
 * 2. Comparison uses timingSafeEqual so response time leaks nothing.
 * 3. Codes are PURPOSE-bound: a CHECKOUT code cannot verify REGISTER.
 * 4. Verify stamps verified_at (single use); consume stamps consumed_at, so a
 *    verified code powers exactly ONE action.
 * 5. If the email fails to send, the row is DELETED - otherwise the cooldown
 *    would block the user from retrying a code they never received.
 */

'use strict';

const crypto = require('crypto');
const config = require('../config/env');
const { query, getClient } = require('../config/db');
const { fail, conflict } = require('../utils/serviceError');
const mailer = require('./mailerService');

function hashCode(code) {
  return crypto.createHash('sha256').update(code, 'utf8').digest();
}

function hashHex(code) {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Opportunistic cleanup (no cron needed): old rows die on the next request. */
async function prune() {
  await query(
    `DELETE FROM otp_codes
      WHERE expires_at < NOW() - INTERVAL '1 day'
         OR consumed_at < NOW() - INTERVAL '1 day';`
  ).catch((err) => console.error('[otp] prune failed:', err.message));
}

async function requestCode(email, purpose) {
  await prune();
  const clean = email.toLowerCase();

  // Resend cooldown: one code per minute per email+purpose.
  const { rows: recent } = await query(
    `SELECT created_at FROM otp_codes
      WHERE email = $1 AND purpose = $2
      ORDER BY created_at DESC LIMIT 1;`,
    [clean, purpose]
  );
  if (recent.length > 0) {
    const waitMs = config.otp.cooldownSeconds * 1000 - (Date.now() - new Date(recent[0].created_at).getTime());
    if (waitMs > 0) {
      const retryAfter = Math.ceil(waitMs / 1000);
      throw Object.assign(
        fail(429, 'OTP_COOLDOWN',
          `Please wait ${retryAfter} second(s) before requesting another code.`,
          `Maghintay ng ${retryAfter} segundo bago humingi ng bagong code.`),
        { retryAfter }
      );
    }
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const { rows } = await query(
    `INSERT INTO otp_codes (email, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)
     RETURNING id;`,
    [clean, hashHex(code), purpose, String(config.otp.codeMinutes)]
  );

  try {
    await mailer.sendOtp(clean, { code, purpose, minutes: config.otp.codeMinutes });
  } catch (err) {
    // Email failed -> remove the row so cooldown does not trap the user.
    await query('DELETE FROM otp_codes WHERE id = $1;', [rows[0].id]).catch(() => {});
    throw err;
  }
  return { expires_in_minutes: config.otp.codeMinutes };
}

async function verifyCode(email, code, purpose) {
  const clean = email.toLowerCase();
  const { rows } = await query(
    `SELECT * FROM otp_codes
      WHERE email = $1 AND purpose = $2
        AND verified_at IS NULL AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1;`,
    [clean, purpose]
  );
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    throw fail(400, 'OTP_INVALID',
      'Code expired or not found. Please request a new code.',
      'Expired o hindi nahanap ang code. Humingi ng bagong code.');
  }
  if (row.attempts >= config.otp.maxAttempts) {
    await query('DELETE FROM otp_codes WHERE id = $1;', [row.id]);
    throw fail(429, 'OTP_LOCKED',
      'Too many wrong attempts. Please request a new code.',
      'Masyadong maraming maling pagtatangka. Humingi ng bagong code.');
  }

  const guess = hashCode(code);
  const stored = Buffer.from(row.code_hash, 'hex');
  const match = guess.length === stored.length && crypto.timingSafeEqual(guess, stored);
  if (!match) {
    const attempts = row.attempts + 1;
    await query('UPDATE otp_codes SET attempts = $1 WHERE id = $2;', [attempts, row.id]);
    if (attempts >= config.otp.maxAttempts) {
      await query('DELETE FROM otp_codes WHERE id = $1;', [row.id]);
      throw fail(429, 'OTP_LOCKED',
        'Too many wrong attempts. Please request a new code.',
        'Masyadong maraming maling pagtatangka. Humingi ng bagong code.');
    }
    const left = config.otp.maxAttempts - attempts;
    throw fail(400, 'OTP_WRONG',
      `Incorrect code. ${left} attempt(s) remaining.`,
      `Maling code. May ${left} pagtatangka pa.`);
  }

  await query('UPDATE otp_codes SET verified_at = NOW() WHERE id = $1;', [row.id]);
  return { verified: true };
}

/**
 * Atomically claim a fresh verification for one action. Runs INSIDE the
 * caller's transaction (register, checkout) so the check and the claim cannot
 * split across concurrent requests. Returns true when a row was consumed.
 */
async function consumeVerification(client, email, purpose) {
  const { rows } = await client.query(
    `UPDATE otp_codes
        SET consumed_at = NOW()
      WHERE id = (
        SELECT id FROM otp_codes
         WHERE email = $1 AND purpose = $2
           AND verified_at IS NOT NULL AND consumed_at IS NULL
           AND verified_at > NOW() - ($3 || ' minutes')::interval
         ORDER BY verified_at DESC LIMIT 1
      )
      RETURNING id;`,
    [email.toLowerCase(), purpose, String(config.otp.verifiedTtlMinutes)]
  );
  return rows.length > 0;
}

module.exports = { requestCode, verifyCode, consumeVerification };
