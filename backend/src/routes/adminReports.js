/**
 * Admin report routes.
 *   GET  /api/admin/reports/dashboard      one-payload admin home stats
 *   GET  /api/admin/reports/sales          JSON (?period=&anchor=&from=&to=)
 *   GET  /api/admin/reports/summary        alias for /sales
 *   GET  /api/admin/reports/sales.pdf      same data as a PDF download
 *   GET  /api/admin/reports/unpaid-orders  unpaid orders grouped by customer
 *   POST /api/admin/reports/record-payment record manual partner payment
 *   POST /api/admin/reports/payments/:id/void void manual partner payment
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const { validateQuery, validateBody } = require('../validators/common');
const { salesQuerySchema, recordPaymentSchema, voidPaymentSchema } = require('../validators/reports');
const reportsController = require('../controllers/reportsController');

const router = express.Router();

router.use(requireAdmin);

router.get('/dashboard', asyncHandler(reportsController.dashboard));
router.get('/sales', validateQuery(salesQuerySchema), asyncHandler(reportsController.sales));
router.get('/summary', validateQuery(salesQuerySchema), asyncHandler(reportsController.sales));
router.get('/sales.pdf', validateQuery(salesQuerySchema), asyncHandler(reportsController.salesPdf));

router.get('/unpaid-orders', asyncHandler(reportsController.unpaidOrders));
router.post('/record-payment', validateBody(recordPaymentSchema), asyncHandler(reportsController.recordPayment));
router.post('/payments/:id/void', validateBody(voidPaymentSchema), asyncHandler(reportsController.voidPayment));

module.exports = router;
