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
    /** Polished in-page modal alert replacing browser native pop-up. */
    alert(message, title) {
      return new Promise((resolve) => {
        let backdrop = document.getElementById('admin-modal-alert');
        if (!backdrop) {
          backdrop = document.createElement('div');
          backdrop.id = 'admin-modal-alert';
          backdrop.className = 'admin-modal-alert-backdrop';
          backdrop.innerHTML =
            '<div class="admin-modal-alert-dialog" role="dialog" aria-modal="true">' +
            '<div class="admin-modal-alert-icon" id="admin-modal-alert-icon"><i class="fas fa-info"></i></div>' +
            '<h3 class="admin-modal-alert-title" id="admin-modal-alert-title">Notice</h3>' +
            '<div class="admin-modal-alert-text" id="admin-modal-alert-text"></div>' +
            '<button type="button" class="btn btn-primary admin-modal-alert-btn" id="admin-modal-alert-btn">OK</button>' +
            '</div>';
          document.body.appendChild(backdrop);
        }
        const textEl = document.getElementById('admin-modal-alert-text');
        const titleEl = document.getElementById('admin-modal-alert-title');
        const iconEl = document.getElementById('admin-modal-alert-icon');
        const btn = document.getElementById('admin-modal-alert-btn');

        const msgStr = String(message || '');
        const isErr = /error|fail|cannot|short|insufficient|out of stock|required/i.test(msgStr);
        const isSuccess = /saved|updated|created|success|confirmed|verified|completed|restored|sent|closed/i.test(msgStr);

        iconEl.className = 'admin-modal-alert-icon' + (isErr ? ' is-error' : (isSuccess ? ' is-success' : ''));
        iconEl.innerHTML = isErr ? '<i class="fas fa-exclamation-triangle"></i>' : (isSuccess ? '<i class="fas fa-check"></i>' : '<i class="fas fa-info"></i>');
        titleEl.textContent = title || (isErr ? 'Notice' : (isSuccess ? 'Success' : 'Information'));
        textEl.textContent = msgStr;

        backdrop.classList.add('is-active');
        btn.focus();

        const close = () => {
          backdrop.classList.remove('is-active');
          btn.removeEventListener('click', onOk);
          backdrop.removeEventListener('click', onBackdrop);
          document.removeEventListener('keydown', onKey);
          resolve();
        };
        const onOk = () => close();
        const onBackdrop = (e) => { if (e.target === backdrop) close(); };
        const onKey = (e) => {
          if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault();
            close();
          }
        };
        btn.addEventListener('click', onOk);
        backdrop.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
      });
    },
    /** Toast notification helper */
    toast(message, type = 'info') {
      let toastEl = document.getElementById('admin-toast');
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'admin-toast';
        document.body.appendChild(toastEl);
      }
      toastEl.className = type === 'success' ? 'toast-success' : type === 'danger' ? 'toast-danger' : '';
      toastEl.textContent = message;
      toastEl.classList.add('active');
      clearTimeout(toastEl._timer);
      toastEl._timer = setTimeout(() => toastEl.classList.remove('active'), 3200);
    },
  };

  // Replace native browser window.alert across all admin views
  window.alert = function (message) {
    window.AdminUI.alert(message);
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
      const backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'sidebar-backdrop';
      backdrop.setAttribute('aria-label', 'Close navigation');
      backdrop.hidden = true;
      document.body.appendChild(backdrop);
      const closeMenu = () => {
        sidebar.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        backdrop.hidden = true;
      };
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const isOpen = sidebar.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(isOpen));
        backdrop.hidden = !isOpen;
      });
      backdrop.addEventListener('click', closeMenu);
      sidebar.querySelectorAll('.nav-item-link').forEach((link) => {
        link.addEventListener('click', closeMenu);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMenu();
      });
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
