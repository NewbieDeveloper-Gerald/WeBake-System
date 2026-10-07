/**
 * Public product routes: the shop catalog. No login needed.
 * GET /api/products
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const productsController = require('../controllers/productsController');

const router = express.Router();

router.get('/', asyncHandler(productsController.listPublic));

module.exports = router;
