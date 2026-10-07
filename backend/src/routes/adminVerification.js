/**
 * Payment verification queue route.
 *   GET /api/admin/verification   PUV orders with pending proof + signed URL
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const paymentsController = require('../controllers/paymentsController');

const router = express.Router();

router.use(requireAdmin);

router.get('/', asyncHandler(paymentsController.queue));

module.exports = router;
