/**
 * zod schema for sales-report queries (JSON + PDF share it).
 * period: daily (anchor day), weekly (Mon-Sun week of anchor), monthly.
 * anchor: YYYY-MM-DD, defaults to today when omitted.
 */

'use strict';

const { z } = require('zod');

const salesQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  anchor: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

module.exports = { salesQuerySchema };
