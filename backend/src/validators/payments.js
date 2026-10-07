/**
 * zod schemas for downpayment submission and admin verification.
 *
 * REFERENCE RULES (spec): GCash references are exactly 13 digits, PayMaya
 * exactly 16. The check is channel-dependent, so a superRefine inspects both
 * fields together instead of validating reference_number in isolation.
 */

'use strict';

const { z } = require('zod');
const { emailField } = require('./common');

const submitPaymentSchema = z.object({
  channel: z.enum(['GCASH', 'MAYA']),
  reference_number: z.string().trim().min(1),
  // Phase 6 fix: guests prove ownership with Order ID (URL) + email (body),
  // same rule as cancel/refund-details. Members omit it (JWT identity).
  email: emailField.optional(),
}).strict().superRefine((v, ctx) => {
  const digitsOnly = /^\d+$/.test(v.reference_number);
  const expected = v.channel === 'GCASH' ? 13 : 16;
  if (!digitsOnly || v.reference_number.length !== expected) {
    ctx.addIssue({
      code: 'custom',
      path: ['reference_number'],
      message: v.channel === 'GCASH' ? 'payment.ref_gcash' : 'payment.ref_maya',
    });
  }
});

/** Admin rejection always explains why (customer reads it in the email). */
const rejectPaymentSchema = z.object({
  reason: z.string().trim().min(5).max(500, { message: 'payment.reason' }),
}).strict();

module.exports = { submitPaymentSchema, rejectPaymentSchema };
