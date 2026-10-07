/**
 * ====================================================================
 * WeBake - Global Frontend Configuration (config.js)
 * Central configuration for API endpoints, payment info, and bakery constants
 * ====================================================================
 */

(function (window) {
  'use strict';

  const isLocal = window.location.protocol === 'file:' ||
                  window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1';

  window.WEBAKE_CONFIG = Object.freeze({
    API_BASE: window.WEBAKE_API_BASE || (isLocal ? 'http://localhost:5000/api' : '/api'),
    PAYMENT_PHONE: '0912 221 7577',
    PAYMENT_NAME: 'Angelita B. Amadeo',
    SUPPORT_EMAIL: 'crbwebake@gmail.com',
    SUPPORT_PHONE: '0917 123 4567',
    BAKERY_ADDRESS: '1356 Cordero St., Lambakin, Marilao, Bulacan',
    STANDARD_DELIVERY_FEE: 50.00,
    DOWNPAYMENT_PERCENTAGE: 50
  });

  // Backward compatibility
  window.WEBAKE_API_BASE = window.WEBAKE_CONFIG.API_BASE;
})(window);
