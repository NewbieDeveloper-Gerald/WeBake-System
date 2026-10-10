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

const multer = require('multer');
const { uploadProductImage } = require('../services/storageService');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    const err = new Error('Only JPG, PNG, or WebP images are allowed.');
    err.code = 'BAD_FILE_TYPE';
    return cb(err);
  },
}).single('image');

router.post('/upload-image', (req, res, next) => {
  imageUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    try {
      const result = await uploadProductImage(req.file.buffer, {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      return res.json({ success: true, image_url: result.url });
    } catch (e) {
      return next(e);
    }
  });
});

router.get('/movements', asyncHandler(productsController.movements));
router.get('/low-stock', asyncHandler(productsController.lowStock));
router.get('/', asyncHandler(productsController.listAdmin));
router.post('/', validateBody(createProductSchema), asyncHandler(productsController.create));
router.put('/:id', validateBody(updateProductSchema), asyncHandler(productsController.update));
router.delete('/:id', asyncHandler(productsController.archive));
router.post('/:id/restore', asyncHandler(productsController.restore));
router.patch('/:id/adjust', validateBody(adjustStockSchema), asyncHandler(productsController.adjust));

module.exports = router;
