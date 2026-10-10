/**
 * Customer modals: track-order lookup dialog (modals.js).
 *
 * WHAT: Every "Order Status" link (data-track-order-open) opens one modal:
 * Order ID + Gmail -> track.html. Self-contained markup + styles so no shell
 * edits are needed on any of the six customer pages.
 */
(function (window, document) {
  'use strict';

  function ensureModal() {
    if (document.getElementById('track-modal')) return;
    const style = document.createElement('style');
    style.textContent =
      '#track-modal{display:none;position:fixed;inset:0;z-index:2000;align-items:center;justify-content:center;padding:16px}' +
      '#track-modal.open{display:flex}' +
      '#track-modal .tm-backdrop{position:absolute;inset:0;background:rgba(46,24,18,.55)}' +
      '#track-modal .tm-card{position:relative;background:#fff;border-radius:14px;max-width:400px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.25)}' +
      '#track-modal h3{margin:0 0 4px;color:var(--primary,#6B352A)}' +
      '#track-modal p{margin:0 0 16px;color:var(--gray,#777);font-size:.9rem}';
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'track-modal';
    wrap.innerHTML =
      '<div class="tm-backdrop" data-tm-close></div>' +
      '<div class="tm-card" role="dialog" aria-label="Order status">' +
      '<h3 data-i18n="nav.track">Order Status</h3>' +
      '<p>WB-XXXXX + Gmail</p>' +
      '<form id="track-modal-form">' +
      '<div class="form-group"><input class="form-input" id="tm-code" placeholder="WB-XXXXX" required autocomplete="off"></div>' +
      '<div class="form-group"><input class="form-input" id="tm-email" type="email" placeholder="you@gmail.com" required></div>' +
      '<button type="submit" class="btn btn-primary btn-block">Check Status</button> ' +
      '<button type="button" class="btn btn-outline btn-block" data-tm-close style="margin-top:.5rem">Close</button>' +
      '</form></div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-tm-close]')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    document.getElementById('track-modal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = document.getElementById('tm-code').value.trim().toUpperCase();
      const email = document.getElementById('tm-email').value.trim();
      if (!code || !email) return;
      window.location.href = 'track.html?code=' + encodeURIComponent(code) +
        '&email=' + encodeURIComponent(email);
    });
    if (window.WB_I18N) window.WB_I18N.applyI18n();
  }

  function open(prefillCode) {
    ensureModal();
    if (prefillCode) document.getElementById('tm-code').value = prefillCode;
    document.getElementById('track-modal').classList.add('open');
    document.getElementById('tm-code').focus();
  }

  function close() {
    const m = document.getElementById('track-modal');
    if (m) m.classList.remove('open');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-track-order-open]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        open();
      });
    });
  });

  window.TrackModal = { open, close };
})(window, document);
