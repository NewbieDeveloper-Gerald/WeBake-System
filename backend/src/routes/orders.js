/**
 * Customer order routes (guests + members).
 *
 *   POST /api/orders                       create (server-priced, 300 min)
 *   GET  /api/orders/track?code=&email=    guest/member tracking lookup
 *   GET  /api/orders/mine                   member order history (JWT)
 *   POST /api/orders/:code/cancel           cancel + refund request (OTP-free
 *                                           by design: Order ID + email proves
 *                                           ownership; rate-limited)
 *   POST /api/orders/:code/refund-details   wallet details after rejection
 *
 * Cancel and refund-details share one identity rule (see ordersController):
 * valid member token wins, otherwise the body email must match the order.
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireMember = require('../middleware/requireMember');
const uploadProof = require('../middleware/uploadProof');
const { cancelLimiter, refundDetailsLimiter, paymentLimiter } = require('../middleware/rateLimits');
const { validateBody, validateQuery } = require('../validators/common');
const {
  createOrderSchema, trackQuerySchema, cancelOrderSchema, refundDetailsSchema,
} = require('../validators/orders');
const { submitPaymentSchema } = require('../validators/payments');
const ordersController = require('../controllers/ordersController');
const paymentsController = require('../controllers/paymentsController');

const router = express.Router();

router.post('/', validateBody(createOrderSchema), asyncHandler(ordersController.create));
router.get('/track', validateQuery(trackQuerySchema), asyncHandler(ordersController.track));
router.get('/mine', requireMember, asyncHandler(ordersController.mine));
// Multipart first (populates req.file + req.body), THEN validation.
router.post('/:code/payment',
  paymentLimiter,
  uploadProof,
  validateBody(submitPaymentSchema),
  asyncHandler(paymentsController.submit));
router.post('/:code/cancel',
  cancelLimiter,
  validateBody(cancelOrderSchema),
  asyncHandler(ordersController.cancel));
router.post('/:code/refund-details',
  refundDetailsLimiter,
  validateBody(refundDetailsSchema),
  asyncHandler(ordersController.refundDetails));

module.exports = router;
