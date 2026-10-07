/**
 * Authentication service (business logic for login).
 *
 * WHAT: Looks up the account, verifies the password, and returns a signed JWT.
 *
 * WHY a service layer: route files only wire URLs to controllers; controllers
 * only translate HTTP <-> JS; ALL decisions live here, where they can be unit
 * tested without spinning up Express.
 *
 * SECURITY NOTE: success and failure return the SAME generic message. Telling
 * a guesser "email not found" vs "wrong password" lets them harvest which
 * emails have accounts (account enumeration). Uniform messages close that leak.
 */

'use strict';

const { query } = require('../config/db');
const { verifyPassword } = require('../utils/password');
const { signMemberToken, signAdminToken } = require('../utils/jwt');

const INVALID_CREDENTIALS = {
  code: 'INVALID_CREDENTIALS',
  message_en: 'Invalid email or password.',
  message_fil: 'Mali ang email o password.',
};

function authError() {
  // Attaching .status lets errorHandler pick 401 instead of 500.
  return Object.assign(new Error(INVALID_CREDENTIALS.message_en), {
    status: 401,
    ...INVALID_CREDENTIALS,
  });
}

async function loginMember(email, password) {
  const { rows } = await query(
    `SELECT id, full_name, email, contact, address, password_hash, email_verified_at
       FROM members
      WHERE email = $1
      LIMIT 1;`,
    [email] // Already lowercased + trimmed by the zod schema.
  );

  const member = rows[0];
  // Check the hash even when no row exists? No row means no hash to check, so
  // just fail closed. (Dummy-hash timing defense is overkill for this scale;
  // the uniform message is the protection that matters here.)
  if (!member || !(await verifyPassword(password, member.password_hash))) {
    throw authError();
  }

  const token = signMemberToken({ id: member.id, email: member.email });
  return {
    token,
    member: {
      id: member.id,
      name: member.full_name,
      email: member.email,
      contact: member.contact,
      address: member.address,
      emailVerified: member.email_verified_at !== null,
    },
  };
}

async function loginAdmin(email, password) {
  const { rows } = await query(
    `SELECT id, email, password_hash
       FROM admins
      WHERE email = $1
      LIMIT 1;`,
    [email]
  );

  const admin = rows[0];
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    throw authError();
  }

  const token = signAdminToken({ id: admin.id, email: admin.email });
  return { token, admin: { id: admin.id, email: admin.email } };
}

module.exports = { loginMember, loginAdmin };
