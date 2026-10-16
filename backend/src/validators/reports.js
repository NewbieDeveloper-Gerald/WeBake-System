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

module.exports = { salesQuerySchema };
