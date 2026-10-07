/**
 * Admin refund queue routes.
 *
 *   GET  /api/admin/refunds                 badge counts + queue rows
 *   POST /api/admin/refunds/:id/mark-refunded   money sent (optional ref + note)
 *   POST /api/admin/refunds/:id/close          no money sent (note REQUIRED)
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const { validateBody } = require('../validators/common');
const { markRefundedSchema, closeRefundSchema } = require('../validators/refunds');
const refundsController = require('../controllers/refundsController');

const router = express.Router();

router.use(requireAdmin);

router.get('/', asyncHandler(refundsController.queue));
router.post('/:id/mark-refunded',
  validateBody(markRefundedSchema),
  asyncHandler(refundsController.markRefunded));
router.post('/:id/close',
  validateBody(closeRefundSchema),
  asyncHandler(refundsController.close));

module.exports = router;
