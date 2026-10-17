/**
 * zod schema for sales-report queries (JSON + PDF share it).
 * period: today | daily | yesterday | weekly | monthly | last7days | custom.
 * anchor: YYYY-MM-DD, defaults to today in Asia/Manila.
 * from, to: YYYY-MM-DD (for custom ranges).
 * compare: boolean or string flag to toggle previous period comparison.
 */

'use strict';

const { z } = require('zod');

const dateParam = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
);

const salesQuerySchema = z.object({
  period: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.enum(['today', 'daily', 'yesterday', 'weekly', 'monthly', 'last7days', 'custom']).default('today')
  ),
  anchor: dateParam,
  from: dateParam,
  to: dateParam,
  compare: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.union([z.string(), z.boolean()]).optional()
  ),
}).passthrough();

const recordPaymentSchema = z.object({
  customer_name: z.string().trim().min(1, 'Customer name is required'),
  order_id: z.coerce.number().int().positive('Valid order ID is required'),
  amount: z.coerce.number().positive('Payment amount must be greater than 0'),
  payment_method: z.enum(['CASH', 'GCASH', 'BANK_TRANSFER', 'OTHER']),
  date_received: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid date YYYY-MM-DD required'),
  reference_number: z.string().trim().max(100).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

const voidPaymentSchema = z.object({
  reason: z.string().trim().min(1, 'Void reason is required').max(255),
});

module.exports = { salesQuerySchema, recordPaymentSchema, voidPaymentSchema };

