/**
 * admin-settings: bakery configuration form (legacy shell).
 *
 * WHAT: Loads all settings into the form, saves partial updates. Wallet
 * numbers keep the 09XXXXXXXXX format; QR fields are PATHS to committed
 * images (no upload endpoint on the free tier - see docs/render-integration).
 *
 * LEGACY ADAPTATIONS: cutoff time + delivery areas have no backend keys and
 * are hidden; the QR file pickers are hidden (paths only); minimum order +
 * low-stock default inputs are injected (admin-editable business rules).
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-bakery-settings');
    if (!form) return; // not this page

    const ui = window.AdminUI;
    const api = window.AdminAPI;

    // Hide keys the rebuilt backend does not own.
    ['set-cutoff-time', 'set-delivery-areas'].forEach((id) => {
      const el = document.getElementById(id);
      const group = el && el.closest('.form-group');
      if (group) group.style.display = 'none';
    });
    // No QR upload endpoint: keep the path textboxes, hide the file pickers.
    ['file-gcash-qr', 'file-maya-qr'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Inject the two business-rule settings the backend DOES own.
    const extra = document.createElement('div');
    extra.innerHTML =
      '<div class="form-group"><label class="form-label">Minimum online order (bundles, all products combined)</label>' +
      '<input type="number" id="set-min-bundles" class="form-input" min="1" max="100000"></div>' +
      '<div class="form-group"><label class="form-label">Default low-stock threshold for NEW products (pieces)</label>' +
      '<input type="number" id="set-low-stock" class="form-input" min="0" max="10000000"></div>';
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    form.insertBefore(extra, submitBtn || null);

    // Stored QR paths are site-root-relative (e.g. assets/x.png); this page
    // sits two levels deep, so resolve before previewing (same rule as checkout).
    function resolveQr(raw) {
      const v = String(raw || '').trim();
      if (!v || /^(https?:|\/|data:|\.\.\/)/.test(v)) return v;
      return '../../' + v;
    }

    // Live QR previews from the path textboxes.
    [['set-gcash-qr', 'preview-gcash-qr'], ['set-maya-qr', 'preview-maya-qr']].forEach(([input, img]) => {
      document.getElementById(input).addEventListener('input', (e) => {
        document.getElementById(img).src = resolveQr(e.target.value);
      });
    });

    async function load() {
      const { settings: s } = await api.settingsGet();
      setVal('set-acc-name', s.account_name);
      setVal('set-gcash-num', s.gcash_number);
      setVal('set-maya-num', s.paymaya_number);
      setVal('set-gcash-qr', s.gcash_qr);
      setVal('set-maya-qr', s.paymaya_qr);
      setVal('set-store-hours', s.store_hours);
      setVal('set-min-bundles', s.min_order_bundles || '300');
      setVal('set-low-stock', s.default_low_stock_pieces || '500');
      if (s.gcash_qr) document.getElementById('preview-gcash-qr').src = resolveQr(s.gcash_qr);
      if (s.paymaya_qr) document.getElementById('preview-maya-qr').src = resolveQr(s.paymaya_qr);
    }

    function setVal(id, v) {
      const el = document.getElementById(id);
      if (el) el.value = v === undefined || v === null ? '' : v;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await api.settingsUpdate({
          account_name: document.getElementById('set-acc-name').value.trim(),
          gcash_number: document.getElementById('set-gcash-num').value.trim(),
          paymaya_number: document.getElementById('set-maya-num').value.trim(),
          gcash_qr: document.getElementById('set-gcash-qr').value.trim(),
          paymaya_qr: document.getElementById('set-maya-qr').value.trim(),
          store_hours: document.getElementById('set-store-hours').value.trim(),
          min_order_bundles: Number(document.getElementById('set-min-bundles').value),
          default_low_stock_pieces: Number(document.getElementById('set-low-stock').value),
        });
        window.alert('Settings saved. The checkout page reads them immediately.');
      } catch (err) {
        window.alert(err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    load().catch((err) => window.alert(err.message));
  });
})();
