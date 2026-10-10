'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { query } = require('../backend/src/config/db');

const BASE_URL = 'http://localhost:5000/api';

async function req(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

(async () => {
  console.log('--- Testing Item 5: Daily Inventory Restructuring & Product Catalog ---');

  // 1. Verify products.html markup structure
  const productsHtml = fs.readFileSync(path.join(__dirname, '../frontend/admin/html/products.html'), 'utf8');

  // Must contain Bakery Products, Manual Stock Adjustment, and Audit History in correct order
  const bakeryIdx = productsHtml.indexOf('Bakery Products');
  const adjustIdx = productsHtml.indexOf('Manual Stock Adjustment');
  const historyIdx = productsHtml.indexOf('Production &amp; Loss Audit History');

  assert(bakeryIdx !== -1, 'Bakery Products must exist in products.html');
  assert(adjustIdx !== -1, 'Manual Stock Adjustment must exist in products.html');
  assert(historyIdx !== -1, 'Production & Loss Audit History must exist in products.html');
  assert(bakeryIdx < adjustIdx, 'Bakery Products must be placed before Manual Stock Adjustment');
  assert(adjustIdx < historyIdx, 'Manual Stock Adjustment must be placed before Production & Loss Audit History');

  // Must contain elements for stock adjustment and audit history
  assert(productsHtml.includes('id="section-stock-adjustment"'), 'Must have section-stock-adjustment');
  assert(productsHtml.includes('id="form-adjust-stock"'), 'Must have form-adjust-stock');
  assert(productsHtml.includes('id="adjust-product"'), 'Must have adjust-product select');
  assert(productsHtml.includes('id="adjust-qty"'), 'Must have adjust-qty input');
  assert(productsHtml.includes('id="section-stock-history"'), 'Must have section-stock-history');
  assert(productsHtml.includes('id="inventory-history-tbody"'), 'Must have inventory-history-tbody');
  assert(productsHtml.includes('id="filter-history-product"'), 'Must have filter-history-product select');

  console.log('✓ 1. products.html contains all sections in exact order (Bakery Products → Manual Stock Adjustment → Audit History)');

  // 2. Verify inventory.html has removed Live Stock Monitoring and obsolete sections
  const inventoryHtml = fs.readFileSync(path.join(__dirname, '../frontend/admin/html/inventory.html'), 'utf8');
  assert(!inventoryHtml.includes('id="inventory-table-body"'), 'inventory.html must not contain inventory-table-body');
  assert(!inventoryHtml.includes('Live Stock Monitoring'), 'inventory.html must not contain Live Stock Monitoring');
  assert(!inventoryHtml.includes('id="form-log-batch"'), 'inventory.html must not contain form-log-batch');
  assert(!inventoryHtml.includes('id="form-log-spoilage"'), 'inventory.html must not contain form-log-spoilage');
  assert(!inventoryHtml.includes('id="inventory-history-tbody"'), 'inventory.html must not contain duplicate inventory-history-tbody');
  assert(inventoryHtml.includes('products.html#section-stock-adjustment'), 'inventory.html must redirect to products.html');
  console.log('✓ 2. inventory.html has Live Stock Monitoring and duplicate sections removed');

  // 3. Test Stock Adjustment API functionality and movement logging
  const { signAdminToken } = require('../backend/src/utils/jwt');
  const adminToken = signAdminToken({ id: 1, email: 'crbwebake@gmail.com' });
  const authHeaders = { Authorization: `Bearer ${adminToken}` };

  // Fetch product list
  const prodsRes = await req('/admin/products', { headers: authHeaders });
  assert.strictEqual(prodsRes.status, 200);
  const products = prodsRes.data.products;
  assert(products.length > 0, 'No products found');
  const testProd = products[0];
  const initialStock = testProd.stock_pieces;

  // Perform stock adjustment
  const adjustQty = 25; // 25 pieces (1 bundle)
  const adjustRes = await req(`/admin/products/${testProd.id}/adjust`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      reason: 'RESTOCK',
      change_pieces: adjustQty,
      note: 'Item 5 automated test restock'
    })
  });
  assert.strictEqual(adjustRes.status, 200, `Stock adjust failed: ${JSON.stringify(adjustRes.data)}`);
  assert.strictEqual(adjustRes.data.product.stock_pieces, initialStock + adjustQty, 'Stock must be updated');

  // Verify movement is in movements API
  const movementsRes = await req(`/admin/products/movements?product_id=${testProd.id}&limit=10`, { headers: authHeaders });
  assert.strictEqual(movementsRes.status, 200);
  const movements = movementsRes.data.movements;
  assert(movements.length > 0, 'Movements must have at least one record');
  const latestMovement = movements[0];
  assert.strictEqual(latestMovement.reason, 'RESTOCK');
  assert.strictEqual(latestMovement.change_pieces, adjustQty);
  assert.strictEqual(latestMovement.note, 'Item 5 automated test restock');

  // Revert stock adjustment cleanly
  await req(`/admin/products/${testProd.id}/adjust`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      reason: 'ADJUSTMENT',
      change_pieces: -adjustQty,
      note: 'Item 5 automated test cleanup'
    })
  });

  // Verify stock reverted
  const finalProdsRes = await req('/admin/products', { headers: authHeaders });
  const finalProd = finalProdsRes.data.products.find(p => p.id === testProd.id);
  assert.strictEqual(finalProd.stock_pieces, initialStock, 'Stock must revert to initial');

  console.log('✓ 3. Stock adjustment API and audit movement history logging verified');
  console.log('--- ALL ITEM 5 TESTS PASSED ---');
  process.exit(0);
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
