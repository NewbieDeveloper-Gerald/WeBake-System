/**
 * zod schemas for authentication routes (Phase 2: login only).
 *
 * WHAT: Defines exactly what a login request must look like.
 *
 * WHY a separate file per domain: auth rules change for different reasons than
 * order rules. Grouping validators by route area keeps diffs small and lets a
 * learner find "what does login accept" in one obvious place.
 *
 * Registration and password-reset schemas land in Phase 4 with the OTP flow,
 * because registration is gated by email verification (proof required).
 */

'use strict';

const { z } = require('zod');
const { emailField, passwordField } = require('./common');

/** POST /api/auth/member/login and POST /api/auth/admin/login share a shape. */
const loginSchema = z.object({
  email: emailField,
  password: passwordField,
}).strict(); // .strict() rejects unknown keys (typos, injected fields).

module.exports = { loginSchema };
