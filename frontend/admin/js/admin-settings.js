/**
 * admin-settings: bakery configuration form with interactive QR upload & live sync.
 *
 * WHAT: Loads all settings into the form, saves partial updates. Supports
 * drag-and-drop & file selection for GCash & Maya QR codes (read as DataURL),
 * which directly reflect in customer checkout payments.
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

    // Inject the two business-rule settings the backend DOES own.
    const extra = document.createElement('div');
    extra.innerHTML =
      '<div class="form-group"><label class="form-label">Minimum online order (bundles, all products combined)</label>' +
      '<input type="number" id="set-min-bundles" class="form-input" min="1" max="100000"></div>' +
      '<div class="form-group"><label class="form-label">Default low-stock threshold for NEW products (pieces)</label>' +
      '<input type="number" id="set-low-stock" class="form-input" min="0" max="10000000"></div>';
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    form.insertBefore(extra, submitBtn || null);

    function resolveQr(raw, fallback = 'assets/qr-gcash-placeholder.png') {
      const v = String(raw || '').trim();
      if (!v) return '../../' + fallback;
      if (/^(https?:|\/|data:|\.\.\/)/.test(v)) return v;
      return '../../' + v;
    }

    // Live QR previews from the path textboxes.
    [['set-gcash-qr', 'preview-gcash-qr', 'assets/qr-gcash-placeholder.png'],
     ['set-maya-qr', 'preview-maya-qr', 'assets/qr-paymaya-placeholder.png']].forEach(([input, img, fb]) => {
      const el = document.getElementById(input);
      if (el) {
        el.addEventListener('input', (e) => {
          document.getElementById(img).src = resolveQr(e.target.value, fb);
        });
      }
    });

    // Wire 11 max digits enforcement
    ['set-gcash-num', 'set-maya-num'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.maxLength = 11;
        el.addEventListener('input', () => {
          el.value = el.value.replace(/\D/g, '').slice(0, 11);
        });
      }
    });

    // Wire Drag & Drop and File Picker for QR images
    function setupQrUploader(dropzoneId, fileInputId, textInputId, previewImgId, resetBtnId, statusId, defaultPath) {
      const dropzone = document.getElementById(dropzoneId);
      const fileInput = document.getElementById(fileInputId);
      const textInput = document.getElementById(textInputId);
      const previewImg = document.getElementById(previewImgId);
      const resetBtn = document.getElementById(resetBtnId);
      const statusEl = document.getElementById(statusId);

      function handleFile(file) {
        if (!file || !file.type.startsWith('image/')) {
          ui.alert('Please select or drop a valid image file (PNG, JPG, SVG, WebP).');
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target.result;
          textInput.value = dataUrl;
          previewImg.src = dataUrl;
          if (statusEl) statusEl.innerHTML = '<i class="fas fa-image text-primary"></i> Selected: ' + ui.esc(file.name);
          ui.toast('QR image loaded! Click "Save Bakery Settings" to apply.', 'success');
        };
        reader.readAsDataURL(file);
      }

      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
          }
        });
      }

      if (dropzone) {
        ['dragenter', 'dragover'].forEach((eventName) => {
          dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
          });
        });

        ['dragleave', 'drop'].forEach((eventName) => {
          dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
          });
        });

        dropzone.addEventListener('drop', (e) => {
          const dt = e.dataTransfer;
          if (dt && dt.files && dt.files[0]) {
            handleFile(dt.files[0]);
          }
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          textInput.value = defaultPath;
          previewImg.src = resolveQr(defaultPath, defaultPath);
          if (fileInput) fileInput.value = '';
          if (statusEl) statusEl.innerHTML = '<i class="fas fa-rotate-left text-muted"></i> Reset to default template';
          ui.toast('QR reset to default template.', 'info');
        });
      }
    }

    setupQrUploader('dropzone-gcash', 'file-gcash-qr', 'set-gcash-qr', 'preview-gcash-qr', 'btn-reset-gcash-qr', 'status-gcash-qr', 'assets/qr-gcash-placeholder.png');
    setupQrUploader('dropzone-maya', 'file-maya-qr', 'set-maya-qr', 'preview-maya-qr', 'btn-reset-maya-qr', 'status-maya-qr', 'assets/qr-paymaya-placeholder.png');

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
      if (s.gcash_qr) document.getElementById('preview-gcash-qr').src = resolveQr(s.gcash_qr, 'assets/qr-gcash-placeholder.png');
      if (s.paymaya_qr) document.getElementById('preview-maya-qr').src = resolveQr(s.paymaya_qr, 'assets/qr-paymaya-placeholder.png');
    }

    function setVal(id, v) {
      const el = document.getElementById(id);
      if (el) el.value = v === undefined || v === null ? '' : v;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const gcashNum = document.getElementById('set-gcash-num').value.replace(/\D/g, '').trim();
      const mayaNum = document.getElementById('set-maya-num').value.replace(/\D/g, '').trim();
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
        await api.settingsUpdate({
          account_name: document.getElementById('set-acc-name').value.trim(),
          gcash_number: gcashNum,
          paymaya_number: mayaNum,
          gcash_qr: document.getElementById('set-gcash-qr').value.trim(),
          paymaya_qr: document.getElementById('set-maya-qr').value.trim(),
          store_hours: document.getElementById('set-store-hours').value.trim(),
          min_order_bundles: Number(document.getElementById('set-min-bundles').value),
          default_low_stock_pieces: Number(document.getElementById('set-low-stock').value),
        });
        ui.alert('Bakery settings saved! Payment credentials and QR codes are now updated live for customer checkout.', 'Settings Saved');
      } catch (err) {
        ui.alert(err.message, 'Error Saving Settings');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    load().catch((err) => ui.alert(err.message, 'Failed to Load Settings'));
  });
})();
