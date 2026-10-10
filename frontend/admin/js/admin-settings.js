/**
 * admin-settings: bakery configuration & payment credentials management.
 *
 * WHAT: Loads and updates merchant name, GCash/Maya numbers, QR code images,
 * and online order thresholds directly in the database.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-bakery-settings');
    if (!form) return;

    const ui = window.AdminUI;
    const api = window.AdminAPI;

    function resolveQr(raw, fallback) {
      const v = String(raw || '').trim();
      if (!v || v.startsWith('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQ')) {
        return '../../' + fallback;
      }
      if (/^(https?:|\/|data:|\.\.\/)/.test(v)) return v;
      return '../../' + v;
    }

    // Wire 11-digit phone number formatting
    ['set-gcash-num', 'set-maya-num'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.maxLength = 11;
        el.addEventListener('input', () => {
          el.value = el.value.replace(/\D/g, '').slice(0, 11);
        });
      }
    });

    // Helper to wire simple file selection + preview (no drag and drop)
    function wireQrSelector(fileInputId, hiddenInputId, previewImgId, resetBtnId, statusId, defaultPath) {
      const fileInput = document.getElementById(fileInputId);
      const hiddenInput = document.getElementById(hiddenInputId);
      const previewImg = document.getElementById(previewImgId);
      const resetBtn = document.getElementById(resetBtnId);
      const statusEl = document.getElementById(statusId);

      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          if (!file.type.startsWith('image/')) {
            ui.alert('Please select an image file (PNG, JPG, WebP).', 'Invalid File');
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            ui.alert('QR Image must be under 5MB in size.', 'File Too Large');
            return;
          }

          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            if (hiddenInput) hiddenInput.value = dataUrl;
            if (previewImg) previewImg.src = dataUrl;
            if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle text-success"></i> Selected: ' + ui.esc(file.name);
            ui.toast('QR Image loaded! Click "Save Bakery Settings" to apply.', 'success');
          };
          reader.readAsDataURL(file);
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          if (hiddenInput) hiddenInput.value = defaultPath;
          if (previewImg) previewImg.src = resolveQr(defaultPath, defaultPath);
          if (fileInput) fileInput.value = '';
          if (statusEl) statusEl.innerHTML = '<i class="fas fa-rotate-left text-muted"></i> Reset to default template';
          ui.toast('QR reset to default placeholder.', 'info');
        });
      }
    }

    wireQrSelector('file-gcash-qr', 'set-gcash-qr', 'preview-gcash-qr', 'btn-reset-gcash-qr', 'status-gcash-qr', 'assets/qr-gcash-placeholder.png');
    wireQrSelector('file-maya-qr', 'set-maya-qr', 'preview-maya-qr', 'btn-reset-maya-qr', 'status-maya-qr', 'assets/qr-paymaya-placeholder.png');

    function setVal(id, v) {
      const el = document.getElementById(id);
      if (el) el.value = v === undefined || v === null ? '' : v;
    }

    async function load() {
      const { settings: s } = await api.settingsGet();
      if (!s) return;
      setVal('set-acc-name', s.account_name);
      setVal('set-gcash-num', s.gcash_number);
      setVal('set-maya-num', s.paymaya_number);
      setVal('set-gcash-qr', s.gcash_qr);
      setVal('set-maya-qr', s.paymaya_qr);
      setVal('set-min-bundles', s.min_order_bundles || '300');
      setVal('set-low-stock', s.default_low_stock_pieces || '500');

      const prevG = document.getElementById('preview-gcash-qr');
      if (prevG) prevG.src = resolveQr(s.gcash_qr, 'assets/qr-gcash-placeholder.png');

      const prevM = document.getElementById('preview-maya-qr');
      if (prevM) prevM.src = resolveQr(s.paymaya_qr, 'assets/qr-paymaya-placeholder.png');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const gcashNum = document.getElementById('set-gcash-num').value.replace(/\D/g, '').trim();
      const mayaNum = document.getElementById('set-maya-num').value.replace(/\D/g, '').trim();
      const accName = document.getElementById('set-acc-name').value.trim();

      if (!accName) {
        ui.alert('Please enter a merchant Account Name.', 'Account Name Required');
        return;
      }
      if (!/^09\d{9}$/.test(gcashNum)) {
        ui.alert('GCash receiving number must be 11 digits starting with 09 (e.g. 09171234567).', 'Invalid GCash Number');
        return;
      }
      if (!/^09\d{9}$/.test(mayaNum)) {
        ui.alert('PayMaya receiving number must be 11 digits starting with 09 (e.g. 09181234567).', 'Invalid PayMaya Number');
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;

      try {
        const payload = {
          account_name: accName,
          gcash_number: gcashNum,
          paymaya_number: mayaNum,
          gcash_qr: (document.getElementById('set-gcash-qr')?.value || '').trim(),
          paymaya_qr: (document.getElementById('set-maya-qr')?.value || '').trim(),
          min_order_bundles: Number(document.getElementById('set-min-bundles')?.value) || 300,
          default_low_stock_pieces: Number(document.getElementById('set-low-stock')?.value) || 500,
        };

        const res = await api.settingsUpdate(payload);
        ui.alert('Bakery settings saved! Payment credentials and order rules are updated directly in the database and customer checkout.', 'Settings Saved');
        if (res && res.settings) {
          await load();
        }
      } catch (err) {
        ui.alert(err.message, 'Error Saving Settings');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    load().catch((err) => ui.alert(err.message, 'Failed to Load Settings'));
  });
})();
