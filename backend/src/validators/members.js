/**
 * zod schemas for member registration, profile, and password flows.
 *
 * Registration is OTP-gated at the SERVICE layer (fresh REGISTER verification
 * required), not here: schemas validate shape, services validate state.
 */

'use strict';

const { z } = require('zod');
const { emailField, passwordField, mobileField } = require('./common');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailField,
  password: passwordField,
  contact: mobileField,
  address: z.string().trim().min(5).max(300),
}).strict();

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  contact: mobileField.optional(),
  address: z.string().trim().min(5).max(300).optional(),
  locale: z.enum(['en', 'fil']).optional(),
}).strict();

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: passwordField,
}).strict();

/** Member forgot-password: applied after a RESET OTP was verified. */
const memberResetSchema = z.object({
  email: emailField,
  new_password: passwordField,
}).strict();

const adminResetRequestSchema = z.object({
  email: emailField,
}).strict();

const adminResetConfirmSchema = z.object({
  token: z.string().trim().min(32).max(128),
  new_password: passwordField,
}).strict();

module.exports = {
  registerSchema,
  updateProfileSchema,
  changePasswordSchema,
  memberResetSchema,
  adminResetRequestSchema,
  adminResetConfirmSchema,
};
