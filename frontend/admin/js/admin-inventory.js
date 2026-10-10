/**
 * admin-inventory.js
 *
 * Daily Inventory stock adjustments and audit history have been consolidated
 * into the Product Catalog (admin-products.js).
 */
(function () {
  'use strict';
  if (window.location.pathname.endsWith('inventory.html')) {
    window.location.replace('products.html#section-stock-adjustment');
  }
})();
