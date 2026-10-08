/**
 * zod schema for the member cart (spec Q9: DB-persisted, cross-device).
 * Lines are product + whole bundles only - prices always come from the live
 * catalog at checkout, never from the cart. merge=true adds guest-cart lines
 * into the saved cart (login handoff); false replaces it.
 */

'use strict';

const { z } = require('zod');
const ORDER_QUANTITIES = require('../config/orderQuantityOptions');

const cartSchema = z.object({
  items: z.array(z.object({
    product_id: z.coerce.number().int().positive(),
    bundles: z.coerce.number().int().refine((n) => ORDER_QUANTITIES.includes(n), {
      message: 'cart.quantity_invalid',
    }),
  }).strict()).max(50).default([]),
  merge: z.coerce.boolean().default(false),
}).strict();

module.exports = { cartSchema };
