/**
 * Admin Ingredients & Stock Movement Routes.
 * All endpoints protected by requireAdmin.
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const requireAdmin = require('../middleware/requireAdmin');
const ingredientService = require('../services/ingredientService');

const router = express.Router();

router.use(requireAdmin);

// GET /api/admin/ingredients - list all ingredients with status and summary metrics
router.get('/', asyncHandler(async (req, res) => {
  const data = await ingredientService.list();
  res.json({ success: true, ...data });
}));

// POST /api/admin/ingredients - create a new ingredient
router.post('/', asyncHandler(async (req, res) => {
  const actor = req.admin?.email || 'admin';
  const ingredient = await ingredientService.create(req.body, actor);
  res.status(201).json({ success: true, ingredient });
}));

// GET /api/admin/ingredients/:id - single ingredient details
router.get('/:id', asyncHandler(async (req, res) => {
  const ingredient = await ingredientService.getById(req.params.id);
  res.json({ success: true, ingredient });
}));

// PUT /api/admin/ingredients/:id - update catalog fields (not stock)
router.put('/:id', asyncHandler(async (req, res) => {
  const ingredient = await ingredientService.update(req.params.id, req.body);
  res.json({ success: true, ingredient });
}));

// DELETE /api/admin/ingredients/:id - remove ingredient
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await ingredientService.remove(req.params.id);
  res.json({ success: true, ...result });
}));

// POST /api/admin/ingredients/:id/adjust - adjust stock through the PostgreSQL RPC function
router.post('/:id/adjust', asyncHandler(async (req, res) => {
  const actor = req.admin?.email || 'admin';
  const { type, quantity, reason, unit_cost, supplier } = req.body;
  const result = await ingredientService.adjustStock(
    req.params.id,
    {
      type,
      quantity,
      reason,
      unitCost: unit_cost,
      supplier,
    },
    actor
  );
  res.json({ success: true, ...result });
}));

// GET /api/admin/ingredients/:id/movements - paginated movement history
router.get('/:id/movements', asyncHandler(async (req, res) => {
  const { limit, offset } = req.query;
  const result = await ingredientService.movements(req.params.id, { limit, offset });
  res.json({ success: true, ...result });
}));

module.exports = router;

