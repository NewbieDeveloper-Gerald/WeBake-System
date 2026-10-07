/**
 * admin-main: runs on every authed admin page (sidebar, badges, helpers).
 *
 * WHAT: Redirects to login when no token exists, toggles the mobile sidebar,
 * refreshes the nav badges from ONE dashboard call, and exposes AdminUI
 * helpers (pesos, dates, escaping, status pills) for all page scripts.
 */
(function () {
  'use strict';

  // --- shared helpers (available before DOMContentLoaded for page scripts) ---
  const STATUS_STYLE = {
    PENDING_DOWNPAYMENT: ['var(--warning-bg)', 'var(--warning)'],
    PAYMENT_UNDER_VERIFICATION: ['var(--info-bg)', 'var(--info)'],
    CONFIRMED: ['var(--purple-bg)', 'var(--purple)'],
    IN_PRODUCTION: ['var(--purple-bg)', 'var(--purple)'],
    READY: ['var(--accent-soft)', 'var(--primary)'],
    OUT_FOR_DELIVERY: ['var(--info-bg)', 'var(--info)'],
    COMPLETED: ['var(--success-bg)', 'var(--success)'],
    CANCELLED: ['var(--danger-bg)', 'var(--danger)'],
    AWAITING_DETAILS: ['var(--warning-bg)', 'var(--warning)'],
    PENDING: ['var(--info-bg)', 'var(--info)'],
    REFUNDED: ['var(--success-bg)', 'var(--success)'],
    CLOSED_NO_PAYMENT: ['var(--border-light)', 'var(--text-muted)'],
    IN_STOCK: ['var(--success-bg)', 'var(--success)'],
    LOW_STOCK: ['var(--warning-bg)', 'var(--warning)'],
    OUT_OF_STOCK: ['var(--danger-bg)', 'var(--danger)'],
  };

  const STATUS_LABEL = {
    PENDING_DOWNPAYMENT: 'Pending downpayment',
    PAYMENT_UNDER_VERIFICATION: 'Under verification',
    CONFIRMED: 'Confirmed',
    IN_PRODUCTION: 'In production',
    READY: 'Ready',
    OUT_FOR_DELIVERY: 'Out for delivery',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    AWAITING_DETAILS: 'Awaiting wallet details',
    PENDING: 'Pending payout',
    REFUNDED: 'Refunded',
    CLOSED_NO_PAYMENT: 'Closed, no payment',
    IN_STOCK: 'In stock',
    LOW_STOCK: 'Low stock',
    OUT_OF_STOCK: 'Out of stock',
  };

  window.AdminUI = {
    /** Centavos -> "P1,234.50" (Intl handles grouping + decimals). */
    pesos(cents) {
      return 'P' + (Number(cents || 0) / 100).toLocaleString('en-PH', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    },
    /** ISO -> "Oct 7, 2026, 3:04 PM" in Philippine time. */
    fmtDate(iso) {
      if (!iso) return '-';
      return new Date(iso).toLocaleString('en-PH', {
        timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    },
    /** Escape user-controlled text before innerHTML injection (XSS guard). */
    esc(value) {
      return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    /** Colored status pill using the design-system variables. */
    pill(status) {
      const key = String(status || '').toUpperCase();
      const style = STATUS_STYLE[key] || ['var(--border-light)', 'var(--text-muted)'];
      const label = STATUS_LABEL[key] || status;
      return '<span style="display:inline-block;padding:2px 10px;border-radius:9999px;' +
        'font-size:0.75rem;font-weight:600;background:' + style[0] + ';color:' + style[1] + ';">' +
        window.AdminUI.esc(label) + '</span>';
    },
    /** Plain confirm() wrapper so pages read intent, not browser API. */
    confirmAsk(message) {
      return window.confirm(message);
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Pages WITHOUT the sidebar (login/reset) skip everything below.
    if (!document.querySelector('.admin-sidebar')) return;

    // Guard: no token -> login (AdminAPI also bounces on 401 mid-session).
    if (!localStorage.getItem('webake_admin_token')) {
      location.href = 'login.html';
      return;
    }

    // Mobile sidebar toggle.
    const toggle = document.querySelector('.mobile-menu-toggle');
    const sidebar = document.querySelector('.admin-sidebar');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    }

    // Nav badges from ONE call (dashboard stats carry queue depths).
    const ordersBadge = document.getElementById('sidebar-orders-badge');
    const refundsBadge = document.getElementById('sidebar-refunds-badge');
    window.AdminAPI.dashboardStats()
      .then((data) => {
        const s = data.stats || {};
        if (ordersBadge) {
          ordersBadge.textContent = s.pending_verification || 0;
          ordersBadge.style.display = s.pending_verification ? '' : 'none';
        }
        const alerts = (s.refunds && s.refunds.alert_count) || 0;
        if (refundsBadge) {
          refundsBadge.textContent = alerts;
          refundsBadge.style.display = alerts ? '' : 'none';
        }
      })
      .catch(() => { /* badges stay at 0; pages surface errors themselves */ });
  });
})();
