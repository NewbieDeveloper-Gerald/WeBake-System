/**
 * Products controller: thin HTTP layer over productService + inventoryService.
 * Controllers never write SQL - they translate req/res and delegate.
 */

'use strict';

const productService = require('../services/productService');
const inventoryService = require('../services/inventoryService');

async function listPublic(req, res) {
  const products = await productService.listPublic();
  return res.json({ success: true, count: products.length, products });
}

async function listAdmin(req, res) {
  const products = await productService.listAdmin();
  return res.json({ success: true, count: products.length, products });
}

async function create(req, res) {
  const product = await productService.create(req.body, req.admin.email);
  return res.status(201).json({ success: true, product });
}

async function update(req, res) {
  const product = await productService.update(req.params.id, req.body);
  return res.json({ success: true, product });
}

async function archive(req, res) {
  const product = await productService.setArchived(req.params.id, true);
  return res.json({ success: true, message: 'Product archived.', product });
}

async function restore(req, res) {
  const product = await productService.setArchived(req.params.id, false);
  return res.json({ success: true, message: 'Product restored.', product });
}

async function adjust(req, res) {
  const { set_pieces, change_pieces, reason, note } = req.body;
  const product = await inventoryService.adjust(
    req.params.id,
    { setPieces: set_pieces, changePieces: change_pieces },
    reason,
    note,
    req.admin.email
  );
  return res.json({ success: true, product });
}

async function movements(req, res) {
  const rows = await inventoryService.movements({
    productId: req.query.product_id ? Number(req.query.product_id) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 100,
  });
  return res.json({ success: true, count: rows.length, movements: rows });
}

async function lowStock(req, res) {
  const products = await inventoryService.lowStock();
  return res.json({ success: true, count: products.length, products });
}

module.exports = {
  listPublic, listAdmin, create, update, archive, restore,
  adjust, movements, lowStock,
};
