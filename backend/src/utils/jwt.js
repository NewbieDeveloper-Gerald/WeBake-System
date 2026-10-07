/**
 * JWT (JSON Web Token) helpers.
 *
 * WHAT: Sign short-lived tokens at login; verify them on every protected route.
 *
 * WHY JWT here: the frontend is a separate static site (Vercel) calling an API
 * (Render). A signed token lets the API verify identity without keeping a
 * session table or sticky cookies across two domains.
 *
 * TOKEN SHAPE: { sub, email, role, iat, exp }
 * - sub:  member/admin numeric id ("subject" - standard JWT claim name)
 * - role: "member" or "admin" - decides which middleware accepts the token
 * - exp:  expiry timestamp - jsonwebtoken rejects expired tokens automatically
 */

'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');

function signToken(payload, expiresIn) {
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn });
}

/** Token for a customer account. Long-lived (7 days) for convenience. */
function signMemberToken(member) {
  return signToken(
    { sub: member.id, email: member.email, role: 'member' },
    config.auth.memberExpiresIn
  );
}

/** Token for the single owner account. Short-lived (12h) to limit exposure. */
function signAdminToken(admin) {
  return signToken(
    { sub: admin.id, email: admin.email, role: 'admin' },
    config.auth.adminExpiresIn
  );
}

/**
 * Verify a token from the Authorization header. Returns the decoded payload,
 * or null when the token is missing, expired, tampered with, or signed with a
 * different secret. Callers map null -> 401 Unauthorized.
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch {
    return null; // Covers TokenExpiredError, JsonWebTokenError, etc.
  }
}

/** Pulls the token out of "Authorization: Bearer <token>". */
function bearerFromHeader(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

module.exports = { signMemberToken, signAdminToken, verifyToken, bearerFromHeader };
