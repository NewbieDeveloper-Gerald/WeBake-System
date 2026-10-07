/**
 * zod schemas for OTP request/verify.
 * Purposes: REGISTER (new account), CHECKOUT (guest order email), RESET
 * (member forgot-password). One endpoint pair serves all three; the purpose
 * binds a code to its context so a checkout code can never reset a password.
 */

'use strict';

const { z } = require('zod');
const { emailField } = require('./common');

const purposeField = z.enum(['REGISTER', 'CHECKOUT', 'RESET']);

const requestSchema = z.object({
  email: emailField,
  purpose: purposeField,
}).strict();

const verifySchema = z.object({
  email: emailField,
  purpose: purposeField,
  code: z.string().trim().regex(/^\d{6}$/, { message: 'otp.format' }),
}).strict();

module.exports = { requestSchema, verifySchema };
