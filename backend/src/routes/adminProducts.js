/**
 * Admin catalog + inventory routes (all under requireAdmin).
 *
 *   GET    /api/admin/products            list all incl. archived
 *   POST   /api/admin/products            create (+ optional opening stock)
 *   PUT    /api/admin/products/:id        update catalog fields (not stock)
 *   DELETE /api/admin/products/:id        archive (soft delete - history kept)
 *   POST   /api/admin/products/:id/restore  unarchive
 *   PATCH  /api/admin/products/:id/adjust   restock / correct (logged)
 *   GET    /api/admin/products/movements    stock movement history
 *   GET    /api/admin/products/low-stock    attention list
 *
 * NOTE on route order: /movements and /low-stock are declared BEFORE /:id
 * routes, or Express would read "movements" as an :id. Order matters.
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const { validateBody } = require('../validators/common');
const {
  createProductSchema, updateProductSchema, adjustStockSchema,
} = require('../validators/products');
const productsController = require('../controllers/productsController');

const router = express.Router();

router.use(requireAdmin);

router.get('/movements', asyncHandler(productsController.movements));
router.get('/low-stock', asyncHandler(productsController.lowStock));
router.get('/', asyncHandler(productsController.listAdmin));
router.post('/', validateBody(createProductSchema), asyncHandler(productsController.create));
router.put('/:id', validateBody(updateProductSchema), asyncHandler(productsController.update));
router.delete('/:id', asyncHandler(productsController.archive));
router.post('/:id/restore', asyncHandler(productsController.restore));
router.patch('/:id/adjust', validateBody(adjustStockSchema), asyncHandler(productsController.adjust));

module.exports = router;
