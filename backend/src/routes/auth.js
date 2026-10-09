/**
 * Authentication routes.
 *
 * WHAT: Maps URLs to middleware chains. Each line reads like a sentence:
 * "POST this path -> rate limit -> validate body -> run controller."
 *
 * WHY no logic here: routes are the table of contents, not the book. Keeping
 * them declarative means a new developer learns the whole auth API at a glance.
 *
 * ENDPOINTS:
 *   POST /api/auth/member/login            member sign-in (JWT)
 *   POST /api/auth/admin/login             owner sign-in (JWT)
 *   POST /api/auth/member/register         new account (OTP-gated in service)
 *   GET  /api/auth/member/profile          own profile (JWT)
 *   PATCH /api/auth/member/profile         update profile (JWT)
 *   POST /api/auth/member/change-password  signed-in password change
 *   POST /api/auth/member/reset-password   forgot-password via RESET OTP
 *   POST /api/auth/admin/forgot-password   owner reset link request
 *   POST /api/auth/admin/reset-password    owner reset link redeem
 *   GET  /api/auth/me                      who-am-I for either role
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireMember = require('../middleware/requireMember');
const requireAdmin = require('../middleware/requireAdmin');
const { loginLimiter } = require('../middleware/rateLimits');
const { validateBody } = require('../validators/common');
const { loginSchema } = require('../validators/auth');
const membersValidators = require('../validators/members');
const authController = require('../controllers/authController');
const membersController = require('../controllers/membersController');

const router = express.Router();

router.post(
  '/member/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(authController.memberLogin)
);

router.post(
  '/admin/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(authController.adminLogin)
);

// --- Member account lifecycle (Phase 4) ---
router.post(
  '/member/register',
  validateBody(membersValidators.registerSchema),
  asyncHandler(membersController.register)
);
router.get('/member/profile', requireMember, asyncHandler(membersController.profile));
router.patch(
  '/member/profile',
  requireMember,
  validateBody(membersValidators.updateProfileSchema),
  asyncHandler(membersController.updateProfile)
);
router.post(
  '/member/change-password',
  requireMember,
  validateBody(membersValidators.changePasswordSchema),
  asyncHandler(membersController.changePassword)
);
router.post(
  '/member/reset-password',
  loginLimiter,
  validateBody(membersValidators.memberResetSchema),
  asyncHandler(membersController.resetPassword)
);

// --- Owner reset via emailed link (spec Q8) ---
router.post(
  '/admin/forgot-password',
  loginLimiter,
  validateBody(membersValidators.adminResetRequestSchema),
  asyncHandler(membersController.adminForgot)
);
router.post(
  '/admin/reset-password',
  loginLimiter,
  validateBody(membersValidators.adminResetConfirmSchema),
  asyncHandler(membersController.adminReset)
);

// Accepts EITHER token type: try member first, fall back to admin.
// (If member fails it already sent 401, so we re-check manually instead.)
router.get('/me', (req, res, next) => {
  const { verifyToken, bearerFromHeader } = require('../utils/jwt');
  const payload = verifyToken(bearerFromHeader(req));
  if (!payload) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Please sign in to continue.',
      message_en: 'Please sign in to continue.',
    });
  }
  if (payload.role === 'admin') return requireAdmin(req, res, () => authController.me(req, res));
  return requireMember(req, res, () => authController.me(req, res));
});

module.exports = router;
