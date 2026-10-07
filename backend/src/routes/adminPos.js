/**
 * Admin POS routes.
 *   POST /api/admin/pos/sale   record a counter sale (returns receipt)
 *   GET  /api/admin/pos/recent recent counter sales (?limit=)
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const { validateBody } = require('../validators/common');
const { saleSchema } = require('../validators/pos');
const posController = require('../controllers/posController');

const router = express.Router();

router.use(requireAdmin);

router.post('/sale', validateBody(saleSchema), asyncHandler(posController.sale));
router.get('/recent', asyncHandler(posController.recent));

module.exports = router;
