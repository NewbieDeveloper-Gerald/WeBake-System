/**
 * Admin authentication guard.
 *
 * WHAT: Same idea as requireMember, but only accepts role:"admin" tokens.
 *
 * WHY separate middleware instead of a flag: every admin route declares its
 * requirement in one readable word (requireAdmin), and a future second role
 * cannot silently inherit admin access through a shared code path.
 */

'use strict';

const { verifyToken, bearerFromHeader } = require('../utils/jwt');

function requireAdmin(req, res, next) {
  const payload = verifyToken(bearerFromHeader(req));

  if (!payload || payload.role !== 'admin') {
    return res.status(401).json({
      success: false,
      code: 'ADMIN_UNAUTHORIZED',
      message_en: 'Admin sign in required.',
      message_fil: 'Kailangan ang pag-sign in ng admin.',
    });
  }

  req.admin = { id: payload.sub, email: payload.email };
  return next();
}

module.exports = requireAdmin;
