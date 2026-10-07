/**
 * Member service: registration, profile, passwords.
 *
 * REGISTRATION RULE: an account is created only when a fresh REGISTER OTP
 * verification exists for the email (consumed atomically in the same
 * transaction). Because the OTP gate runs BEFORE the duplicate-email check,
 * attackers cannot probe which emails are registered - they never reach the
 * check without inbox access.
 *
 * GUEST LINKING (spec): past guest orders with the same verified email attach
 * to the new member id at registration, so order history survives signup.
 */

'use strict';

const { query, getClient } = require('../config/db');
const { fail, conflict } = require('../utils/serviceError');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signMemberToken } = require('../utils/jwt');
const { consumeVerification } = require('./otpService');

function publicMember(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    contact: row.contact,
    address: row.address,
    locale: row.locale,
    emailVerified: row.email_verified_at !== null,
  };
}

async function register(input) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const claimed = await consumeVerification(client, input.email, 'REGISTER');
    if (!claimed) {
      throw fail(409, 'OTP_REQUIRED',
        'Please verify your email with the OTP code before registering.',
        'Pakiberipika muna ang email gamit ang OTP code bago mag-register.');
    }

    const { rows: existing } = await client.query(
      'SELECT id FROM members WHERE email = $1;', [input.email]
    );
    if (existing.length > 0) {
      throw conflict('EMAIL_EXISTS',
        'An account with this email already exists. Please sign in instead.',
        'May account na sa email na ito. Mag-sign in na lang.');
    }

    const passwordHash = await hashPassword(input.password);
    const { rows } = await client.query(
      `INSERT INTO members
         (full_name, email, email_verified_at, contact, address, password_hash, locale)
       VALUES ($1, $2, NOW(), $3, $4, $5, 'en')
       RETURNING *;`,
      [input.name.trim(), input.email, input.contact, input.address.trim(), passwordHash]
    );
    const member = rows[0];

    await client.query(
      'INSERT INTO carts (member_id, items) VALUES ($1, $2) ON CONFLICT DO NOTHING;',
      [member.id, JSON.stringify([])]
    );

    // Link pre-registration guest orders by verified email.
    const { rowCount: linked } = await client.query(
      `UPDATE orders SET member_id = $1
        WHERE member_id IS NULL AND customer_email = $2;`,
      [member.id, input.email]
    );

    await client.query('COMMIT');
    const token = signMemberToken({ id: member.id, email: member.email });
    return { token, member: publicMember(member), linked_orders: linked };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw conflict('EMAIL_EXISTS',
        'An account with this email already exists. Please sign in instead.',
        'May account na sa email na ito. Mag-sign in na lang.');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getProfile(memberId) {
  const { rows } = await query('SELECT * FROM members WHERE id = $1;', [memberId]);
  if (rows.length === 0) {
    throw fail(404, 'NOT_FOUND', 'Account not found.', 'Hindi nahanap ang account.');
  }
  return publicMember(rows[0]);
}

async function updateProfile(memberId, data) {
  const fields = [];
  const values = [];
  if (data.name !== undefined) { values.push(data.name.trim()); fields.push(`full_name = $${values.length}`); }
  if (data.contact !== undefined) { values.push(data.contact); fields.push(`contact = $${values.length}`); }
  if (data.address !== undefined) { values.push(data.address.trim()); fields.push(`address = $${values.length}`); }
  if (data.locale !== undefined) { values.push(data.locale); fields.push(`locale = $${values.length}`); }
  if (fields.length === 0) return getProfile(memberId);

  values.push(memberId);
  const { rows } = await query(
    `UPDATE members SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *;`,
    values
  );
  if (rows.length === 0) {
    throw fail(404, 'NOT_FOUND', 'Account not found.', 'Hindi nahanap ang account.');
  }
  return publicMember(rows[0]);
}

async function changePassword(memberId, currentPassword, newPassword) {
  const { rows } = await query(
    'SELECT password_hash FROM members WHERE id = $1;', [memberId]
  );
  if (rows.length === 0) {
    throw fail(404, 'NOT_FOUND', 'Account not found.', 'Hindi nahanap ang account.');
  }
  if (!(await verifyPassword(currentPassword, rows[0].password_hash))) {
    throw fail(401, 'WRONG_PASSWORD',
      'Current password is incorrect.',
      'Mali ang kasalukuyang password.');
  }
  const passwordHash = await hashPassword(newPassword);
  await query('UPDATE members SET password_hash = $1 WHERE id = $2;',
    [passwordHash, memberId]);
  return true;
}

/** Forgot-password completion: requires a verified RESET OTP (consumed). */
async function resetPasswordWithOtp(email, newPassword) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const claimed = await consumeVerification(client, email, 'RESET');
    if (!claimed) {
      throw fail(409, 'OTP_REQUIRED',
        'Please verify your email with the OTP code first.',
        'Pakiberipika muna ang email gamit ang OTP code.');
    }
    const passwordHash = await hashPassword(newPassword);
    const { rowCount } = await client.query(
      'UPDATE members SET password_hash = $1 WHERE email = $2;',
      [passwordHash, email.toLowerCase()]
    );
    if (rowCount === 0) {
      throw fail(404, 'NOT_FOUND',
        'No account found for this email.',
        'Walang account sa email na ito.');
    }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  register, getProfile, updateProfile, changePassword, resetPasswordWithOtp,
};
