/**
 * Admin settings routes.
 *   GET /api/admin/settings   all keys
 *   PUT /api/admin/settings   partial update (unknown keys rejected)
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const { validateBody } = require('../validators/common');
const { updateSettingsSchema } = require('../validators/settings');
const settingsController = require('../controllers/settingsController');

const router = express.Router();

router.use(requireAdmin);

router.get('/', asyncHandler(settingsController.getAll));
router.put('/', validateBody(updateSettingsSchema), asyncHandler(settingsController.update));

module.exports = router;
