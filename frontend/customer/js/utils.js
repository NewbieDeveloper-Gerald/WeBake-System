/**
 * WeBake customer utilities + English storefront strings (utils.js).
 *
 * WHAT: Shared helpers (escaping, pesos, dates, toasts, ids) and the manual
 * The storefront uses English-only interface strings.
 */
(function (window, document) {
  'use strict';

  /* ---------------- helpers ---------------- */

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatCurrency(amount) {
    const num = parseFloat(amount);
    return Number.isNaN(num) ? 'P0.00' : 'P' + num.toLocaleString('en-PH', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  /** Integer centavos -> "P1,234.50" (the API only speaks centavos). */
  function pesos(centavos) {
    return formatCurrency(Number(centavos || 0) / 100);
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function toast(msg, ms) {
    const t = document.getElementById('toast');
    if (!t) { window.alert(msg); return; }
    t.textContent = msg;
    t.classList.add('active');
    window.clearTimeout(t._hide);
    t._hide = window.setTimeout(() => t.classList.remove('active'), ms || 3200);
  }

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
  }

  /* ---------------- interface strings ---------------- */

  var STRINGS = {
    // nav + shell
    'nav.home': 'Home',
    'nav.products': 'Products',
    'nav.track': 'Track Order',
    'nav.about': 'About Us',
    'nav.signin': 'Sign In',
    'nav.register': 'Register',
    'nav.dashboard': 'Dashboard',
    'nav.signout': 'Sign Out',
    // shop
    'shop.bundles': 'bundles',
    'shop.per_bundle': '/ bundle',
    'shop.add': 'Add to Cart',
    'shop.buy_now': 'Checkout Now',
    'shop.qty': 'Qty (bundles):',
    'shop.min_note': 'Minimum online order: {n} bundles in total (all products combined).',
    'shop.out': 'Out of stock',
    'shop.low': 'Low stock',
    // cart
    'cart.title': 'Your Cart',
    'cart.empty': 'Your cart is empty.',
    'cart.total': 'Total:',
    'cart.continue': 'Continue Browsing',
    'cart.checkout': 'Proceed to Checkout',
    // checkout
    'co.stock_fail': 'Some items exceed available stock. Please adjust your cart.',
    'co.below_min': 'Online orders need at least {n} bundles in total. You have {have}.',
    'co.otp_sent': 'Code sent to {email}. It expires in 10 minutes.',
    'co.otp_bad': 'Invalid code. Please try again.',
    'co.creating': 'Placing your order...',
    'co.down_due': '50% downpayment due now:',
    'co.balance_later': 'Balance on delivery:',
    'co.submit_pay': 'Payment submitted! It is now pending verification. We will email you once approved.',
    'co.verify_email': 'Verify Email',
    'co.otp_prompt': 'Enter the 6-digit code sent to',
    // track
    'tr.lookup': 'Track your order',
    'tr.not_found': 'No matching order found for this tracking ID.',
    'tr.cancel_ok': 'Order cancelled. Your refund request is now pending.',
    'tr.details_ok': 'Wallet details submitted.',
    'tr.pay_ok': 'Payment submitted! It is now pending verification.',
    // auth
    'au.welcome': 'Welcome back!',
    'au.registered': 'Account created! Your past guest orders were linked.',
    'au.reset_sent': 'If this email is registered, a code is on its way.',
    'au.reset_ok': 'Password changed. Please sign in.',
    'au.saved': 'Profile saved.',
    'au.pw_ok': 'Password changed.',
    // common
    'c.loading': 'Loading...',
    'c.network': 'Network error. Please check your connection and retry.',
    'c.resend': 'Resend OTP',
  };

  function t(key, vars) {
    let s = STRINGS[key] || key;
    if (vars) {
      Object.keys(vars).forEach((k) => { s = s.replace('{' + k + '}', vars[k]); });
    }
    return s;
  }

  /** Apply English data-i18n (text) + data-i18n-ph (placeholder) attributes. */
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    const navToggle = document.getElementById('nav-toggle');
    const navLinks = document.getElementById('nav-links');
    if (navToggle && navLinks) {
      navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    }
  });
  window.WeBakeUtils = Object.freeze({ escapeHtml, formatCurrency, pesos, fmtDate, toast, uid });
  window.escapeHtml = escapeHtml; // legacy template compatibility
  window.WB_I18N = { t, applyI18n };
})(window, document);
