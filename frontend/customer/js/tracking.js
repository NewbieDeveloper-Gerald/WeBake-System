/**
 * Order tracking page (tracking.js). Runs track.html - the page every
 * customer email links to.
 *
 * WHAT: Code + Gmail lookup, status timeline, payment submit/resubmit,
 * wallet-details form for awaiting refunds, and the cancel flow. Each action
 * reuses the lookup email for guest identity (members use their token).
 */
(function (window, document) {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('track-lookup');
    if (!form) return; // track page only

    const U = window.WeBakeUtils;
    const t = (k, v) => window.WB_I18N.t(k, v);
    const api = window.ShopAPI;

    const STAGES = ['PAYMENT_UNDER_VERIFICATION', 'CONFIRMED', 'IN_PRODUCTION',
      'OUT_FOR_DELIVERY', 'COMPLETED'];
    const STAGE_LABEL = {
      PAYMENT_UNDER_VERIFICATION: 'Under verification',
      CONFIRMED: 'Confirmed',
      IN_PRODUCTION: 'In production',
      OUT_FOR_DELIVERY: 'Out for delivery',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
    };

    let current = null; // {order, email}

    const params = new URLSearchParams(window.location.search);
    if (params.get('code')) document.getElementById('track-code').value = params.get('code');
    if (params.get('email')) document.getElementById('track-email').value = params.get('email');
    if (params.get('code') && params.get('email')) lookup();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      lookup();
    });

    async function lookup() {
      const code = document.getElementById('track-code').value.trim().toUpperCase();
      const email = document.getElementById('track-email').value.trim().toLowerCase();
      const errBox = document.getElementById('track-error');
      errBox.style.display = 'none';
      document.getElementById('track-result').style.display = 'none';
      try {
        const { order } = await api.track(code, email);
        current = { order, email };
        render(order, email);
        document.getElementById('track-result').style.display = 'block';
      } catch {
        errBox.textContent = t('tr.not_found');
        errBox.style.display = 'block';
      }
    }

    function stageLabel(st) {
      return STAGE_LABEL[st] || st;
    }

    function render(o, email) {
      document.getElementById('track-order-code').textContent = o.order_code;
      document.getElementById('track-status-pill').textContent = stageLabel(o.status);

      // Timeline (cancelled orders show the trail up to cancellation).
      const idx = STAGES.indexOf(o.status);
      document.getElementById('track-timeline').innerHTML = STAGES.map((s, i) =>
        '<div class="tl-step' + (o.status === 'CANCELLED' ? '' : (i < idx ? ' done' : i === idx ? ' now' : '')) + '">' +
        '<span class="tl-dot"></span><span>' + stageLabel(s) + '</span></div>'
      ).join('') + (o.status === 'CANCELLED'
        ? '<div class="tl-step now cancelled"><span class="tl-dot"></span><span>' + stageLabel('CANCELLED') + '</span></div>' : '');

      document.getElementById('track-items').innerHTML = (o.items || []).map((it) =>
        '<div class="review-line"><span>' + U.escapeHtml(it.product_name) + ' x' + it.bundles +
        '</span><span>' + U.pesos(it.line_total_centavos) + '</span></div>').join('');

      document.getElementById('track-amounts').innerHTML =
        '<div class="review-line"><span>Total</span><strong>' + U.pesos(o.total_centavos) + '</strong></div>' +
        '<div class="review-line"><span>Downpayment</span><span>' + U.pesos(o.downpayment_centavos) +
        ' (paid ' + U.pesos(o.downpayment_paid_centavos) + ')</span></div>' +
        '<div class="review-line"><span>Balance due</span><span>' + U.pesos(o.balance_due_centavos) + '</span></div>';

      renderPayment(o, email);
      renderRefund(o, email);
      renderCancel(o, email);
    }

    /* ---------------- payment submit / resubmit ---------------- */

    function renderPayment(o, email) {
      const box = document.getElementById('track-payment');
      if (o.status !== 'PAYMENT_UNDER_VERIFICATION') {
        box.innerHTML = o.downpayment_paid_centavos > 0
          ? '<p class="ok-note">Downpayment verified (' + U.pesos(o.downpayment_paid_centavos) + ').</p>' : '';
        return;
      }
      const pending = (o.payments || []).find((p) =>
        p.stage === 'DOWNPAYMENT' && p.verification_status === 'PENDING');
      if (pending) {
        box.innerHTML = '<p class="pending-note">Payment submitted (' + U.escapeHtml(pending.channel) +
          ' ' + U.escapeHtml(pending.reference_number) + ') - pending verification. We will email you once approved.</p>';
        return;
      }
      // No pending payment: either abandoned checkout or a granted resubmit.
      const isResubmit = (o.resubmit_count || 0) >= 1;
      box.innerHTML =
        (isResubmit && o.rejection_reason
          ? '<p class="reject-note">Rejected: ' + U.escapeHtml(o.rejection_reason) +
            ' You have ONE chance to resubmit.</p>' : '') +
        '<h4>' + (isResubmit ? 'Resubmit payment' : 'Submit payment') + '</h4>' +
        '<form id="track-pay-form">' +
        '<div class="form-row"><div class="form-group"><label>Channel</label>' +
        '<select class="form-input" id="tp-channel"><option value="GCASH">GCash</option>' +
        '<option value="MAYA">Maya</option></select></div>' +
        '<div class="form-group"><label>Reference number</label>' +
        '<input class="form-input" id="tp-ref" required autocomplete="off"></div></div>' +
        '<div class="form-group"><label>Payment screenshot</label>' +
        '<div id="tp-proof-input-wrap"><input class="form-input" id="tp-proof" type="file" accept="image/*" required></div>' +
        '<div id="tp-proof-preview-wrap" style="display:none; margin-top:8px; padding:10px; border:1px solid #e0d0c5; border-radius:8px; background:#fffcf9; align-items:center; gap:12px;">' +
        '<img id="tp-proof-preview-img" src="" alt="Receipt Preview" style="width:52px; height:52px; object-fit:cover; border-radius:6px; border:1px solid #ddd;">' +
        '<div style="flex:1; min-width:0;">' +
        '<div id="tp-proof-filename" style="font-size:0.85rem; font-weight:600; color:var(--primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">receipt.png</div>' +
        '<div id="tp-proof-filesize" style="font-size:0.75rem; color:#888;">Selected image</div>' +
        '</div>' +
        '<button type="button" class="btn btn-danger-outline btn-sm" id="btn-remove-tp-proof" style="padding:0.35rem 0.75rem; font-size:0.8rem;"><i class="fas fa-trash"></i> Remove</button>' +
        '</div></div>' +
        '<button type="submit" class="btn btn-primary">Submit payment</button></form>';

      const tpProofInput = document.getElementById('tp-proof');
      const tpInputWrap = document.getElementById('tp-proof-input-wrap');
      const tpPreviewWrap = document.getElementById('tp-proof-preview-wrap');
      const tpPreviewImg = document.getElementById('tp-proof-preview-img');
      const tpFilename = document.getElementById('tp-proof-filename');
      const tpFilesize = document.getElementById('tp-proof-filesize');
      const btnRemoveTpProof = document.getElementById('btn-remove-tp-proof');

      function clearTpProof() {
        if (tpProofInput) tpProofInput.value = '';
        if (tpPreviewImg) tpPreviewImg.src = '';
        if (tpPreviewWrap) tpPreviewWrap.style.display = 'none';
        if (tpInputWrap) tpInputWrap.style.display = '';
      }

      if (tpProofInput) {
        tpProofInput.addEventListener('change', () => {
          const file = tpProofInput.files && tpProofInput.files[0];
          if (!file) {
            clearTpProof();
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            U.toast('Screenshot must be 5MB or smaller.');
            clearTpProof();
            return;
          }
          if (tpFilename) tpFilename.textContent = file.name;
          if (tpFilesize) tpFilesize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
          if (tpPreviewImg) {
            const reader = new FileReader();
            reader.onload = (ev) => { tpPreviewImg.src = ev.target.result; };
            reader.readAsDataURL(file);
          }
          if (tpInputWrap) tpInputWrap.style.display = 'none';
          if (tpPreviewWrap) tpPreviewWrap.style.display = 'flex';
        });
      }

      if (btnRemoveTpProof) {
        btnRemoveTpProof.addEventListener('click', () => {
          clearTpProof();
        });
      }

      document.getElementById('track-pay-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const channel = document.getElementById('tp-channel').value;
        const ref = document.getElementById('tp-ref').value.trim();
        const expected = channel === 'GCASH' ? 13 : 16;
        if (!/^\d+$/.test(ref) || ref.length !== expected) {
          U.toast('Reference must be ' + expected + ' digits for ' + channel + '.');
          return;
        }
        const file = document.getElementById('tp-proof').files[0];
        if (!file || file.size > 5 * 1024 * 1024) {
          U.toast('Screenshot required (5MB max).');
          return;
        }
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          const form = new FormData();
          form.append('channel', channel);
          form.append('reference_number', ref);
          if (!window.ShopAuth.token()) form.append('email', email);
          form.append('proof', file);
          await api.submitPayment(o.order_code, form, window.ShopAuth.token() || undefined);
          U.toast(t('tr.pay_ok'));
          await lookup();
        } catch (err) {
          U.toast(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    }

    /* ---------------- refund wallet details ---------------- */

    function renderRefund(o, email) {
      const box = document.getElementById('track-refund');
      const r = o.refund;
      if (!r) { box.innerHTML = ''; return; }
      let html = '<h4>Refund: ' + U.pesos(r.refund_amount_centavos) + ' (' +
        U.escapeHtml(r.status.replace(/_/g, ' ').toLowerCase()) + ')</h4>';
      if (r.status === 'AWAITING_DETAILS') {
        html += '<p>Submit your wallet details so the bakery can send your refund. Type the number twice - it cannot be edited after.</p>' +
          '<form id="track-wallet-form">' +
          '<div class="form-row"><div class="form-group"><label>Wallet</label>' +
          '<select class="form-input" id="tw-type"><option value="GCASH">GCash</option>' +
          '<option value="PAYMAYA">PayMaya</option></select></div>' +
          '<div class="form-group"><label>Account name</label>' +
          '<input class="form-input" id="tw-name" required></div></div>' +
          '<div class="form-row"><div class="form-group"><label>Account number (09XXXXXXXXX)</label>' +
          '<input class="form-input" id="tw-num" required inputmode="numeric" maxlength="11"></div>' +
          '<div class="form-group"><label>Retype account number</label>' +
          '<input class="form-input" id="tw-num2" required inputmode="numeric" maxlength="11"></div></div>' +
          '<button type="submit" class="btn btn-primary">Submit wallet details</button></form>';
      } else if (r.wallet_type) {
        html += '<p class="muted">To ' + U.escapeHtml(r.wallet_type) + ' ' +
          U.escapeHtml(r.account_number || '') + ' (' + U.escapeHtml(r.account_name || '') + ')</p>';
      }
      box.innerHTML = html;

      const wf = document.getElementById('track-wallet-form');
      if (wf) wf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const num = document.getElementById('tw-num').value.trim();
        if (num !== document.getElementById('tw-num2').value.trim()) {
          U.toast('The two account numbers do not match.');
          return;
        }
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          const body = {
            wallet_type: document.getElementById('tw-type').value,
            account_number: num,
            account_number_confirm: num,
            account_name: document.getElementById('tw-name').value.trim(),
          };
          if (!window.ShopAuth.token()) body.email = email;
          await api.refundDetails(o.order_code, body, window.ShopAuth.token() || undefined);
          U.toast(t('tr.details_ok'));
          await lookup();
        } catch (err) {
          U.toast(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    }

    /* ---------------- cancel ---------------- */

    function renderCancel(o, email) {
      const box = document.getElementById('track-cancel');
      if (!['PAYMENT_UNDER_VERIFICATION', 'CONFIRMED'].includes(o.status)) {
        box.innerHTML = '';
        return;
      }
      box.innerHTML = '<h4>Cancel this order</h4>' +
        '<p class="muted">Cancellation opens a refund for your downpayment. Wallet details are required now (type the number twice).</p>' +
        '<form id="track-cancel-form">' +
        '<div class="form-group"><label>Reason (min 10 characters)</label>' +
        '<textarea class="form-textarea" id="tc-reason" required></textarea></div>' +
        '<div class="form-row"><div class="form-group"><label>Wallet</label>' +
        '<select class="form-input" id="tc-type"><option value="GCASH">GCash</option>' +
        '<option value="PAYMAYA">PayMaya</option></select></div>' +
        '<div class="form-group"><label>Account name</label>' +
        '<input class="form-input" id="tc-name" required></div></div>' +
        '<div class="form-row"><div class="form-group"><label>Account number</label>' +
        '<input class="form-input" id="tc-num" required inputmode="numeric" maxlength="11"></div>' +
        '<div class="form-group"><label>Retype account number</label>' +
        '<input class="form-input" id="tc-num2" required inputmode="numeric" maxlength="11"></div></div>' +
        '<button type="submit" class="btn btn-outline">Cancel order</button></form>';

      document.getElementById('track-cancel-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const num = document.getElementById('tc-num').value.trim();
        if (num !== document.getElementById('tc-num2').value.trim()) {
          U.toast('The two account numbers do not match.');
          return;
        }
        if (!window.confirm('Cancel ' + o.order_code + '? This cannot be undone.')) return;
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          const body = {
            reason: document.getElementById('tc-reason').value.trim(),
            wallet_type: document.getElementById('tc-type').value,
            account_number: num,
            account_number_confirm: num,
            account_name: document.getElementById('tc-name').value.trim(),
          };
          if (!window.ShopAuth.token()) body.email = email;
          await api.cancelOrder(o.order_code, body, window.ShopAuth.token() || undefined);
          U.toast(t('tr.cancel_ok'));
          await lookup();
        } catch (err) {
          U.toast(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    }
  });
})(window, document);
