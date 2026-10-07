/**
 * Member authentication guard.
 *
 * WHAT: Verifies the JWT on protected customer routes and attaches the member
 * identity to the request.
 *
 * DATA FLOW: Authorization header -> verifyToken() -> req.member = { id, email }
 * Controllers then use req.member.id for ownership checks ("only your orders").
 */

'use strict';

const { verifyToken, bearerFromHeader } = require('../utils/jwt');

function unauthorized(res) {
  return res.status(401).json({
    success: false,
    code: 'UNAUTHORIZED',
    message_en: 'Please sign in to continue.',
    message_fil: 'Mangyaring mag-sign in upang magpatuloy.',
  });
}

function requireMember(req, res, next) {
  const payload = verifyToken(bearerFromHeader(req));

  // Role check matters: an admin token must NOT pass as a member token and
  // vice versa, so stolen-token blast radius stays inside one area.
  if (!payload || payload.role !== 'member') {
    return unauthorized(res);
  }

  req.member = { id: payload.sub, email: payload.email };
  return next();
}

module.exports = requireMember;
