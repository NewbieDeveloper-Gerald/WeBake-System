/**
 * Public settings route (no login): checkout-safe subset for the storefront
 * (wallet numbers, QR paths, store hours, minimum order).
 *   GET /api/settings/public
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const settingsController = require('../controllers/settingsController');

const router = express.Router();

router.get('/public', asyncHandler(settingsController.getPublic));

module.exports = router;
