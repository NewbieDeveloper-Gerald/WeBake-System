/**
 * Single source of truth for the bundle quantity quick-select buttons.
 *
 * Loaded by the browser as a plain script (sets WEBAKE_ORDER_QUANTITY_OPTIONS)
 * and required by the backend (backend/src/config/orderQuantityOptions.js), so
 * one list drives the storefront modal, the cart, the member dashboard cart,
 * the walk-in POS, AND server-side validation.
 *
 * Note: the online minimum is 300 bundles (settings.min_order_bundles), so 250
 * was removed - it could never satisfy the minimum on its own.
 * Change the list in ONE place: here.
 */
(function (root) {
  'use strict';

  const options = Object.freeze([300, 350, 400, 450, 500]);
  if (typeof module === 'object' && module.exports) module.exports = options;
  else root.WEBAKE_ORDER_QUANTITY_OPTIONS = options;
})(typeof window !== 'undefined' ? window : globalThis);
