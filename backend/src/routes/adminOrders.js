/**
 * Admin order management routes.
 *
 *   GET   /api/admin/orders                       list (+ ?status= filter)
 *   GET   /api/admin/orders/:code                 detail with items + history (Phase 5)
 *   POST  /api/admin/orders/:code/approve         verify downpayment (Phase 4)
 *   POST  /api/admin/orders/:code/reject          reject (reason required)
 *   PATCH /api/admin/orders/:code/status          board moves (forward only)
 *   POST  /api/admin/orders/:code/record-balance  cash balance receipt
 *   POST  /api/admin/orders/:code/cancel         admin cancel (refund -> awaiting details)
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const { validateBody } = require('../validators/common');
const { transitionSchema, recordBalanceSchema, adminCancelSchema } = require('../validators/orders');
const { rejectPaymentSchema } = require('../validators/payments');
const ordersController = require('../controllers/ordersController');
const paymentsController = require('../controllers/paymentsController');

const router = express.Router();

router.use(requireAdmin);

router.get('/', asyncHandler(ordersController.adminList));
router.get('/:code', asyncHandler(ordersController.detail));
router.post('/:code/approve', asyncHandler(paymentsController.approve));
router.post('/:code/reject',
  validateBody(rejectPaymentSchema),
  asyncHandler(paymentsController.reject));
router.patch('/:code/status',
  validateBody(transitionSchema),
  asyncHandler(ordersController.transition));
router.post('/:code/record-balance',
  validateBody(recordBalanceSchema),
  asyncHandler(ordersController.recordBalance));
router.post('/:code/cancel',
  validateBody(adminCancelSchema),
  asyncHandler(ordersController.adminCancel));

module.exports = router;
