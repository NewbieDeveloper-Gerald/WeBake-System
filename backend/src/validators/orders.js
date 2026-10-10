/**
 * zod schemas for online orders: create, track, cancel, admin transitions.
 *
 * WHAT: Encodes the confirmed business rules at the HTTP boundary:
 * - Whole bundles only, minimum 300 bundles across ALL products (Q1).
 * - Cancel needs reason + wallet + 09XXXXXXXXX account typed TWICE (Q12).
 * - Guest actions carry email in the payload; members use their JWT instead.
 */

'use strict';

const { z } = require('zod');
const config = require('../config/env');
const { emailField, mobileField } = require('./common');
const { ADMIN_MOVES } = require('../utils/orderMachine');
const ORDER_QUANTITIES = require('../config/orderQuantityOptions');

const MIN_BUNDLES = config.business.minOrderBundles;

const orderItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  bundles: z.coerce.number().int().refine((n) => ORDER_QUANTITIES.includes(n), {
    message: 'order.quantity_invalid',
  }),
}).strict();

const createOrderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(100),
    email: emailField,
    contact: mobileField,
    address: z.string().trim().min(5).max(300),
  }).strict(),
  items: z.array(orderItemSchema).min(1, { message: 'order.min_items' }),
  payment_method: z.enum(['GCASH', 'MAYA']),
  delivery_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'order.bad_date' }).optional(),
  delivery_time: z.string().trim().max(50).default(''),
  notes: z.string().trim().max(500).default(''),
  // Idempotency key: safe retries (double-clicks, timeouts) never duplicate.
  // The controller also accepts it via the X-Idempotency-Key header.
  idempotency_key: z.string().trim().min(8).max(64).optional(),
})
  .strict()
  .refine(
    (v) => v.items.reduce((sum, it) => sum + it.bundles, 0) >= MIN_BUNDLES,
    { message: 'order.min_bundles', path: ['items'] }
  );

const trackQuerySchema = z.object({
  code: z.string().trim().min(3).max(20),
  email: emailField,
}).strict();

/**
 * Shared wallet-details fields used by cancel AND refund-details submit.
 * NOTE: the base object stays separate from the .refine() call because zod's
 * refine() returns a ZodEffects wrapper with no .shape - only the raw
 * ZodObject exposes its fields for reuse below.
 */
const walletFields = {
  wallet_type: z.enum(['GCASH', 'PAYMAYA'], {
    errorMap: () => ({ message: 'cancel.wallet' }),
  }),
  account_number: z.string().trim().regex(/^09\d{9}$/, { message: 'cancel.account' }),
  account_number_confirm: z.string().trim(),
  account_name: z.string().trim().min(2).max(100, { message: 'cancel.name' }),
};

/** Type-twice guard: both account number copies must be identical. */
function mustMatchBothCopies(schema) {
  return schema.refine(
    (v) => v.account_number === v.account_number_confirm,
    { message: 'cancel.mismatch', path: ['account_number_confirm'] }
  );
}

const cancelOrderSchema = mustMatchBothCopies(z.object({
  // Guests prove ownership with Order ID (URL) + email (body). Members omit
  // it; identity comes from the JWT. The controller picks based on the token.
  email: emailField.optional(),
  reason: z.string().trim().min(10).max(500, { message: 'cancel.reason' }),
  ...walletFields,
}).strict());

/**
 * Admin cancel: reason only (min 5). The admin does not know the customer's
 * wallet, so the service opens the refund as AWAITING_DETAILS with NULL
 * wallet fields - the customer submits them later via the emailed link.
 */
const adminCancelSchema = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();

const refundDetailsSchema = mustMatchBothCopies(z.object({
  email: emailField.optional(), // same guest/member rule as cancel
  ...walletFields,
}).strict());

/** Admin board moves: forward only; approval owns PUV->CONFIRMED (Phase 4). */
const transitionSchema = z.object({
  status: z.enum(ADMIN_MOVES),
  note: z.string().trim().max(300).default(''),
}).strict();

const recordBalanceSchema = z.object({
  amount_centavos: z.coerce.number().int().positive().optional(),
  amount: z.coerce.number().positive().optional(),
  note: z.string().trim().max(300).default(''),
}).strict();

module.exports = {
  createOrderSchema,
  trackQuerySchema,
  cancelOrderSchema,
  refundDetailsSchema,
  transitionSchema,
  recordBalanceSchema,
  adminCancelSchema,
};
