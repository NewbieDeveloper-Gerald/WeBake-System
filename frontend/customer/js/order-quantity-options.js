(function (root) {
  'use strict';

  const options = Object.freeze([250, 300, 350, 400, 450, 500]);
  if (typeof module === 'object' && module.exports) module.exports = options;
  else root.WEBAKE_ORDER_QUANTITY_OPTIONS = options;
})(typeof window !== 'undefined' ? window : globalThis);
