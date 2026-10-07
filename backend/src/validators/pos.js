/**
 * zod schema for walk-in POS sales.
 *
 * WHAT: Items sold by BUNDLE or PIECE, plus cash tendered. Prices come from
 * the live catalog server-side (same anti-tamper rule as online orders); the
 * request carries only product + unit + qty. Change is computed, never sent.
 */

'use strict';

const { z } = require('zod');
const { centavosField } = require('./common');

const saleSchema = z.object({
  items: z.array(z.object({
    product_id: z.coerce.number().int().positive(),
    unit: z.enum(['BUNDLE', 'PIECE']),
    qty: z.coerce.number().int().min(1).max(100000),
  }).strict()).min(1),
  cash_received_centavos: centavosField,
}).strict();

module.exports = { saleSchema };
