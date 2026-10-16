/**
 * zod schema for sales-report queries (JSON + PDF share it).
 * period: today | daily | yesterday | weekly | monthly | last7days | custom.
 * anchor: YYYY-MM-DD, defaults to today in Asia/Manila.
 * from, to: YYYY-MM-DD (for custom ranges).
 * compare: boolean or string flag to toggle previous period comparison.
 */

'use strict';

const { z } = require('zod');

const salesQuerySchema = z.object({
  period: z.enum(['today', 'daily', 'yesterday', 'weekly', 'monthly', 'last7days', 'custom']).default('today'),
  anchor: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  compare: z.union([z.string(), z.boolean()]).optional(),
}).strict();

module.exports = { salesQuerySchema };
