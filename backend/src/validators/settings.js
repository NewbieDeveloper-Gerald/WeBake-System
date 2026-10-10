/**
 * zod schema for bakery settings updates.
 *
 * WHAT: All keys optional (partial updates); unknown keys rejected. Wallet
 * numbers keep the canonical 09XXXXXXXXX format so checkout display and
 * refund instructions never disagree.
 */

'use strict';

const { z } = require('zod');

const walletNumber = z.string().trim().regex(/^09\d{9}$/);

const updateSettingsSchema = z.object({
  gcash_number: walletNumber.optional(),
  paymaya_number: walletNumber.optional(),
  account_name: z.string().trim().min(2).max(100).optional(),
  gcash_qr: z.string().trim().max(5_000_000).optional(),
  paymaya_qr: z.string().trim().max(5_000_000).optional(),
  min_order_bundles: z.coerce.number().int().min(1).max(100000).optional(),
  default_low_stock_pieces: z.coerce.number().int().min(0).max(10000000).optional(),
}).strict();

module.exports = { updateSettingsSchema };
