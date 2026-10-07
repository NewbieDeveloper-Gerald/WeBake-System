/**
 * zod schemas for products and inventory adjustments.
 *
 * WHAT: create/update accept catalog fields; stock changes go through the
 * separate adjust schema so EVERY stock write carries a reason + note for the
 * movement log. There is intentionally no way to silently edit stock.
 */

'use strict';

const { z } = require('zod');
const { centavosField } = require('./common');

const nameField = z.string().trim().min(2).max(80);

const createProductSchema = z.object({
  name: nameField,
  description: z.string().trim().max(1000).default(''),
  price_bundle_centavos: centavosField,
  pieces_per_bundle: z.coerce.number().int().min(1).max(1000).default(25),
  piece_price_centavos: centavosField,
  low_stock_threshold_pieces: z.coerce.number().int().min(0).default(500),
  image_url: z.string().trim().max(500).default(''),
  initial_stock_pieces: z.coerce.number().int().min(0).max(10000000).default(0),
}).strict();

const updateProductSchema = z.object({
  name: nameField.optional(),
  description: z.string().trim().max(1000).optional(),
  price_bundle_centavos: centavosField.optional(),
  pieces_per_bundle: z.coerce.number().int().min(1).max(1000).optional(),
  piece_price_centavos: centavosField.optional(),
  low_stock_threshold_pieces: z.coerce.number().int().min(0).optional(),
  image_url: z.string().trim().max(500).optional(),
}).strict();

/**
 * Exactly ONE of set_pieces (absolute) or change_pieces (delta) must be
 * present. Absolute is friendlier ("count says 1200"); the service converts it
 * to a signed delta for the movement log.
 */
const adjustStockSchema = z.object({
  set_pieces: z.coerce.number().int().min(0).max(10000000).optional(),
  change_pieces: z.coerce.number().int().min(-10000000).max(10000000).optional(),
  reason: z.enum(['RESTOCK', 'ADJUSTMENT']),
  note: z.string().trim().max(300).default(''),
}).strict().refine(
  (v) => (v.set_pieces === undefined) !== (v.change_pieces === undefined),
  { message: 'Provide exactly one of set_pieces or change_pieces.' }
);

module.exports = { createProductSchema, updateProductSchema, adjustStockSchema };
