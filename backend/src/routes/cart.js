/**
 * Member cart routes (spec Q9: persists in DB across devices).
 *   GET /api/cart   saved lines
 *   PUT /api/cart   replace lines, or merge guest lines ({merge: true})
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireMember = require('../middleware/requireMember');
const { validateBody } = require('../validators/common');
const { cartSchema } = require('../validators/cart');
const cartController = require('../controllers/cartController');

const router = express.Router();

router.use(requireMember);

router.get('/', asyncHandler(cartController.get));
router.put('/', validateBody(cartSchema), asyncHandler(cartController.put));

module.exports = router;
