/**
 * AdminAPI: typed fetch wrapper for the WeBake backend.
 *
 * WHAT: Every admin page talks to the API through this module. One place owns
 * the base URL, the Bearer token header, error translation, and the 401 rule
 * (session dead -> back to login). Page scripts stay focused on rendering.
 *
 * The base URL comes from customer/js/config.js (window.WB_CONFIG), so the
 * whole frontend - customer AND admin - switches environments in one file.
 */
(function () {
  'use strict';

  function baseUrl() {
    // Phase 6 fix: admin pages load customer/js/config.js, which defines
    // WEBAKE_CONFIG.API_BASE (WITH an /api suffix) - not WB_CONFIG. Support
    // both spellings so this client works in every environment.
    const wb = window.WB_CONFIG && window.WB_CONFIG.API_BASE_URL;
    const legacy = window.WEBAKE_CONFIG && window.WEBAKE_CONFIG.API_BASE;
    const raw = wb || legacy || 'http://localhost:5000';
    return String(raw).replace(/\/$/, '').replace(/\/api$/, '');
  }

  function getToken() {
    return localStorage.getItem('webake_admin_token') || '';
  }

  class ApiError extends Error {
    constructor(message, code, status, details) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'UNKNOWN';
      this.status = status || 0;
      this.details = details;
    }
  }

  /** Thrown body always carries the backend's English message (admin UI is English-only). */
  async function request(method, path, options) {
    const opts = options || {};
    const headers = {};
    let body;
    if (opts.body !== undefined) {
      if (typeof FormData !== 'undefined' && opts.body instanceof FormData) {
        body = opts.body;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
    }
    if (opts.auth !== false) {
      const token = getToken();
      if (token) headers.Authorization = 'Bearer ' + token;
    }
    const res = await fetch(baseUrl() + path, { method, headers, body });

    if (opts.download) {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ApiError(err.message_en || 'Download failed.', err.code, res.status);
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(disp);
      return { blob, filename: m ? m[1] : 'download' };
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Dead session: drop the token and bounce to login (except on login/reset).
      if (res.status === 401 && opts.auth !== false && !/(login|reset)\.html$/.test(location.pathname)) {
        localStorage.removeItem('webake_admin_token');
        localStorage.removeItem('webake_admin_email');
        location.href = 'login.html';
        throw new ApiError('Session expired. Please sign in again.', 'UNAUTHORIZED', 401);
      }
      throw new ApiError(
        data.message_en || data.message || 'Request failed.',
        data.code || 'UNKNOWN',
        res.status,
        data.details
      );
    }
    return data;
  }

  const get = (path, opts) => request('GET', path, opts);
  const post = (path, body, opts) => request('POST', path, Object.assign({}, opts, { body }));
  const put = (path, body, opts) => request('PUT', path, Object.assign({}, opts, { body }));

  window.AdminAPI = {
    ApiError,
    getToken,
    baseUrl,

    // --- auth (Phase 6 fix: the real paths are /admin-scoped; the old ones 404d) ---
    login: (email, password) => post('/api/auth/admin/login', { email, password }, { auth: false }),
    forgotPassword: (email) => post('/api/auth/admin/forgot-password', { email }, { auth: false }),
    resetPassword: (token, new_password) => post('/api/auth/admin/reset-password', { token, new_password }, { auth: false }),
    me: () => get('/api/auth/me'),

    // --- dashboard + reports ---
    dashboardStats: () => get('/api/admin/reports/dashboard'),
    settingsPublic: () => get('/api/settings/public', { auth: false }),
    salesReport: (period, anchor) => {
      const q = new URLSearchParams({ period });
      if (anchor) q.set('anchor', anchor);
      return get('/api/admin/reports/sales?' + q.toString());
    },
    salesPdf: (period, anchor) => {
      const q = new URLSearchParams({ period });
      if (anchor) q.set('anchor', anchor);
      return get('/api/admin/reports/sales.pdf?' + q.toString(), { download: true });
    },

    // --- orders + verification ---
    adminOrders: (params) => get('/api/admin/orders' + (params ? '?' + params : '')),
    orderDetail: (code) => get('/api/admin/orders/' + encodeURIComponent(code)),
    verificationQueue: () => get('/api/admin/verification'),
    approvePayment: (code) => post('/api/admin/orders/' + encodeURIComponent(code) + '/approve', {}),
    rejectPayment: (code, reason) => post('/api/admin/orders/' + encodeURIComponent(code) + '/reject', { reason }),
    transitionOrder: (code, status, note) => request(
      'PATCH', '/api/admin/orders/' + encodeURIComponent(code) + '/status',
      { body: { status, note: note || '' } }
    ),
    recordBalance: (code, note, amount_centavos) => post('/api/admin/orders/' + encodeURIComponent(code) + '/record-balance', {
      note: note || '',
      ...(amount_centavos != null ? { amount_centavos: Number(amount_centavos) } : {}),
    }),
    cancelOrder: (code, reason) => post('/api/admin/orders/' + encodeURIComponent(code) + '/cancel', { reason }),

    // --- refunds (no detail endpoint: the queue row carries everything) ---
    refundsQueue: () => get('/api/admin/refunds'),
    markRefunded: (id, admin_reference_number, note) => post(
      '/api/admin/refunds/' + encodeURIComponent(id) + '/mark-refunded',
      { admin_reference_number: admin_reference_number || '', note: note || '' }
    ),
    refundClose: (id, admin_note) => post('/api/admin/refunds/' + encodeURIComponent(id) + '/close', { admin_note }),

    // --- products (the list carries stock: it doubles as the inventory table) ---
    products: () => get('/api/admin/products'),
    productCreate: (data) => post('/api/admin/products', data),
    productUpdate: (id, data) => put('/api/admin/products/' + encodeURIComponent(id), data),
    productArchive: (id) => request('DELETE', '/api/admin/products/' + encodeURIComponent(id)),
    productRestore: (id) => post('/api/admin/products/' + encodeURIComponent(id) + '/restore', {}),
    productUploadImage: (formData) => request('POST', '/api/admin/products/upload-image', { body: formData }),

    // --- inventory (adjust reasons: RESTOCK adds, ADJUSTMENT corrects) ---
    lowStock: () => get('/api/admin/products/low-stock'),
    movements: (productId, limit) => {
      const q = new URLSearchParams();
      if (productId) q.set('product_id', productId);
      q.set('limit', limit || 100);
      return get('/api/admin/products/movements?' + q.toString());
    },
    adjustStock: (id, data) => request(
      'PATCH', '/api/admin/products/' + encodeURIComponent(id) + '/adjust', { body: data }
    ),

    // --- POS ---
    posSale: (data) => post('/api/admin/pos/sale', data),
    posRecent: (limit) => get('/api/admin/pos/recent' + (limit ? '?limit=' + limit : '')),

    // --- settings ---
    settingsGet: () => get('/api/admin/settings'),
    settingsUpdate: (data) => put('/api/admin/settings', data),
  };
})();
