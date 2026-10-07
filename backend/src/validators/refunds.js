/**
 * zod schemas for admin refund actions.
 *
 * WHAT: mark-refunded takes an optional wallet reference + note; close takes
 * a MANDATORY note explaining why no money is sent (spec Q11), which the
 * customer later reads in the "refund closed" email.
 */

'use strict';

const { z } = require('zod');

const markRefundedSchema = z.object({
  admin_reference_number: z.string().trim().max(30).default(''),
  note: z.string().trim().max(300).default(''),
}).strict();

const closeRefundSchema = z.object({
  admin_note: z.string().trim().min(5).max(500, { message: 'refund.note' }),
}).strict();

module.exports = { markRefundedSchema, closeRefundSchema };
