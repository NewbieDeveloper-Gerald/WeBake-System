/**
 * Admin report routes.
 *   GET /api/admin/reports/dashboard   one-payload admin home stats
 *   GET /api/admin/reports/sales       JSON (?period=daily|weekly|monthly&anchor=YYYY-MM-DD)
 *   GET /api/admin/reports/sales.pdf   same data as a PDF download
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const { validateQuery } = require('../validators/common');
const { salesQuerySchema } = require('../validators/reports');
const reportsController = require('../controllers/reportsController');

const router = express.Router();

router.use(requireAdmin);

router.get('/dashboard', asyncHandler(reportsController.dashboard));
router.get('/sales', validateQuery(salesQuerySchema), asyncHandler(reportsController.sales));
router.get('/sales.pdf', validateQuery(salesQuerySchema), asyncHandler(reportsController.salesPdf));

module.exports = router;
