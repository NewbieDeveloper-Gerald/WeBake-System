/**
 * ShopAPI: typed fetch client for the customer storefront (shop-api.js).
 *
 * WHAT: One module owns the base URL, optional member tokens, multipart
 * payment uploads, and English error messages.
 * Page scripts never call fetch() directly.
 */
(function (window) {
  'use strict';

  function baseUrl() {
    const cfg = window.WEBAKE_CONFIG || {};
    const raw = cfg.API_BASE || window.WEBAKE_API_BASE || 'http://localhost:5000/api';
    return String(raw).replace(/\/$/, '');
  }

  class ApiError extends Error {
    constructor(en, code, status, details) {
      super(en);
      this.name = 'ApiError';
      this.code = code || 'UNKNOWN';
      this.status = status || 0;
      this.details = details;
    }
  }

  async function request(method, path, options) {
    const opts = options || {};
    const headers = {};
    let body;
    // FormData (proof upload) sets its own Content-Type with the boundary.
    if (opts.form) {
      body = opts.form;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const token = opts.token || (window.ShopAuth && window.ShopAuth.token()) || '';
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(baseUrl() + path, { method, headers, body });
    } catch {
      throw new ApiError(
        'Network error. Please check your connection and retry.',
        'NETWORK', 0
      );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(
        data.message_en || data.message || 'Request failed.',
        data.code || 'UNKNOWN', res.status, data.details
      );
    }
    return data;
  }

  const get = (path, opts) => request('GET', path, opts);
  const post = (path, body, opts) => request('POST', path, Object.assign({}, opts, { body }));
  const put = (path, body, opts) => request('PUT', path, Object.assign({}, opts, { body }));
  const patch = (path, body, opts) => request('PATCH', path, Object.assign({}, opts, { body }));

  window.ShopAPI = {
    ApiError,
    baseUrl,

    // --- catalog + public settings + reviews ---
    products: () => get('/products'),
    settingsPublic: () => get('/settings/public?_t=' + Date.now()),
    reviews: (productId) => get('/reviews' + (productId ? '?product_id=' + encodeURIComponent(productId) : '')),
    reviewEligibility: (productId) => get('/reviews/eligibility' + (productId ? '?product_id=' + encodeURIComponent(productId) : '')),
    reviewSubmit: (body) => post('/reviews', body),

    // --- OTP (send, then verify, THEN the gated action) ---
    otpSend: (email, purpose) => post('/otp/send', { email, purpose }),
    otpVerify: (email, purpose, code) => post('/otp/verify', { email, purpose, code }),

    // --- orders (token optional: members skip OTP with their own email) ---
    createOrder: (body, token) => post('/orders', body, { token }),
    track: (code, email) => get('/orders/track?code=' + encodeURIComponent(code) +
      '&email=' + encodeURIComponent(email)),
    mine: () => get('/orders/mine'),
    submitPayment: (code, form, token) => request('POST',
      '/orders/' + encodeURIComponent(code) + '/payment', { form, token }),
    cancelOrder: (code, body, token) => post(
      '/orders/' + encodeURIComponent(code) + '/cancel', body, { token }),
    refundDetails: (code, body, token) => post(
      '/orders/' + encodeURIComponent(code) + '/refund-details', body, { token }),

    // --- members ---
    memberLogin: (email, password) => post('/auth/member/login', { email, password }),
    register: (body) => post('/auth/member/register', body),
    profile: () => get('/auth/member/profile'),
    updateProfile: (body) => patch('/auth/member/profile', body),
    changePassword: (current_password, new_password) =>
      post('/auth/member/change-password', { current_password, new_password }),
    memberReset: (email, new_password) =>
      post('/auth/member/reset-password', { email, new_password }),

    // --- member cart sync ---
    cartGet: () => get('/cart'),
    cartPut: (items, merge) => put('/cart', { items, merge: !!merge }),
  };
})(window);
