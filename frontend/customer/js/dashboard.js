/**
 * Member dashboard (dashboard.js). Runs dashboard.html for signed-in members.
 *
 * WHAT: Profile view/edit, server cart display, order history with track
 * links, and an injected change-password card. Guests bounce to login.
 */
(function (window, document) {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('profile-form')) return; // dashboard only

    const U = window.WeBakeUtils;
    const api = window.ShopAPI;
    let savedCartLines = [];
    let savedCatalog = {};
    const quantityOptions = window.WEBAKE_ORDER_QUANTITY_OPTIONS || [];
    let selectedSavedIds = new Set();

    if (!window.ShopAuth.token()) {
      window.location.href = 'home.html?auth=login&next=dashboard.html';
      return;
    }

    const sessionName = localStorage.getItem('webake_member_name') || '';
    if (sessionName) {
      document.getElementById('dash-name').value = sessionName;
      const greetingName = document.getElementById('dashboard-member-name');
      if (greetingName) greetingName.textContent = sessionName;
    }

    // Change-password card (injected: the shell predates the endpoint).
    const grid = document.querySelector('.dashboard-grid');
    const pwCard = document.createElement('div');
    pwCard.className = 'dash-card';
    pwCard.innerHTML =
      '<div class="dash-card-title"><i class="fas fa-key"></i> Change Password</div>' +
      '<form id="pw-form"><div class="profile-grid">' +
      '<div class="form-group"><label class="dash-label">Current password</label>' +
      '<input type="password" class="form-input" id="cp-current" required autocomplete="current-password"></div>' +
      '<div class="form-group"><label class="dash-label">New password (min 6)</label>' +
      '<input type="password" class="form-input" id="cp-new" required minlength="6" autocomplete="new-password"></div>' +
      '<div class="form-group"><label class="dash-label" for="cp-confirm">Confirm new password</label>' +
      '<input type="password" class="form-input" id="cp-confirm" required minlength="6" autocomplete="new-password" data-match-password="cp-new"></div>' +
      '</div><button type="submit" class="btn btn-primary btn-sm">Change password</button> ' +
      '<span id="cp-msg"></span></form>';
    grid.appendChild(pwCard);

    document.getElementById('pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('cp-msg');
      const newPassword = document.getElementById('cp-new').value;
      if (newPassword.length < 6) {
        msg.textContent = 'New password must be at least 6 characters.';
        msg.style.color = 'var(--danger)';
        return;
      }
      if (newPassword !== document.getElementById('cp-confirm').value) {
        msg.textContent = 'New passwords do not match.';
        msg.style.color = 'var(--danger)';
        return;
      }
      try {
        await api.changePassword(
          document.getElementById('cp-current').value,
          newPassword
        );
        msg.textContent = 'Password changed.';
        msg.style.color = 'var(--success)';
        e.target.reset();
        ['cp-new', 'cp-confirm'].forEach((id) => {
          document.getElementById(id).dispatchEvent(new Event('input', { bubbles: true }));
        });
      } catch (err) {
        msg.textContent = err.message;
        msg.style.color = 'var(--danger)';
      }
    });

    document.getElementById('profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.updateProfile({
          name: document.getElementById('dash-name').value.trim(),
          contact: document.getElementById('dash-contact').value.trim(),
          address: document.getElementById('dash-address').value.trim(),
        });
        const name = document.getElementById('dash-name').value.trim();
        localStorage.setItem('webake_member_name', name);
        const greetingName = document.getElementById('dashboard-member-name');
        if (greetingName) greetingName.textContent = name || 'there';
        U.toast('Profile saved.');
      } catch (err) {
        U.toast(err.message);
      }
    });

    const savedCart = document.getElementById('dash-cart-container');
    savedCart.addEventListener('change', (e) => {
      const quantity = e.target.closest('[data-saved-quantity]');
      if (quantity) {
        savedCartLines[Number(quantity.dataset.savedQuantity)].bundles = Number(quantity.value);
        renderSavedCart();
        saveSavedCart();
        return;
      }
      const checkbox = e.target.closest('[data-saved-select]');
      if (!checkbox) return;
      const id = Number(checkbox.dataset.savedSelect);
      if (checkbox.checked) selectedSavedIds.add(id);
      else selectedSavedIds.delete(id);
      renderSavedCart();
    });
    savedCart.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('[data-saved-quantity]')) return;
      e.preventDefault();
      e.target.checked = true;
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    savedCart.addEventListener('click', async (e) => {
      const remove = e.target.closest('[data-saved-remove]');
      const checkout = e.target.closest('#saved-cart-checkout');
      if (checkout) {
        const ids = savedCartLines.filter((line) => selectedSavedIds.has(Number(line.product_id)))
          .map((line) => Number(line.product_id));
        if (!ids.length) { U.toast('Select at least one product to check out.'); return; }
        if (savedCartLines.some((line) => selectedSavedIds.has(Number(line.product_id)) && !quantityOptions.includes(Number(line.bundles)))) {
          U.toast('Choose one of the available bundle quantities for every selected product.'); return;
        }
        window.location.href = 'products.html?selected=' + encodeURIComponent(ids.join(',')) + '&checkout=1';
        return;
      }
      if (!remove) return;
      const index = Number(remove.dataset.savedRemove);
      selectedSavedIds.delete(Number(savedCartLines[index].product_id));
      savedCartLines.splice(index, 1);
      renderSavedCart();
      await saveSavedCart();
    });

    async function saveSavedCart() {
      localStorage.setItem('webake_cart', JSON.stringify(savedCartLines));
      try {
        await api.cartPut(savedCartLines.map((line) => ({ product_id: Number(line.product_id), bundles: Number(line.bundles) })), false);
      } catch (err) {
        U.toast(err.message);
        load().catch(() => {});
      }
    }

    let allOrders = [];
    let currentMember = null;
    let activeCancelOrder = null;
    let activeRefundOrder = null;

    function renderSavedCart() {
      const lines = savedCartLines;
      const container = document.getElementById('dash-cart-container');
      if (!lines.length) {
        container.innerHTML = '<div class="saved-cart-empty"><span><i class="fas fa-shopping-basket"></i></span><strong>Your cart is empty</strong>' +
          '<p>Choose your bakery favorites and they’ll be saved here.</p>' +
          '<a class="btn btn-primary btn-sm" href="products.html"><i class="fas fa-store"></i> Browse Products</a></div>';
        return;
      }
      const selected = lines.filter((line) => selectedSavedIds.has(Number(line.product_id)));
      const cartTotal = selected.reduce((sum, line) => {
        const product = savedCatalog[Number(line.product_id)];
        return sum + (product ? Number(line.bundles || 0) * Number(product.price_bundle_centavos || 0) : 0);
      }, 0);
      container.innerHTML = '<div class="saved-cart-list">' + lines.map((line, index) => {
        const product = savedCatalog[Number(line.product_id)];
        const name = product ? product.name : '#' + line.product_id;
        const bundles = Number(line.bundles || 0);
        const pieces = bundles * Number(product && product.pieces_per_bundle || 25);
        const total = product ? U.pesos(bundles * product.price_bundle_centavos) : '-';
        const available = Number(product && product.bundles_available || 0);
        return '<div class="saved-cart-item' + (selectedSavedIds.has(Number(line.product_id)) ? ' is-selected' : '') + '">' +
          '<label class="saved-cart-select"><input type="checkbox" data-saved-select="' + Number(line.product_id) + '"' +
          (selectedSavedIds.has(Number(line.product_id)) ? ' checked' : '') + ' aria-label="Select ' + U.escapeHtml(name) + '">' +
          '<span class="saved-cart-icon"><i class="fas fa-bread-slice"></i></span></label>' +
          '<span class="saved-cart-details"><strong>' + U.escapeHtml(name) + '</strong><small>' +
          bundles.toLocaleString() + ' bundles · ' + pieces.toLocaleString() + ' pcs</small></span>' +
          '<div class="saved-quantity-wrap"><div class="quantity-options saved-quantity-options">' + quantityOptions.map((qty) =>
            '<label class="quantity-option' + (qty === bundles ? ' selected' : '') + (qty > available ? ' unavailable' : '') + '">' +
            '<input type="radio" name="saved-quantity-' + index + '" value="' + qty + '" data-saved-quantity="' + index + '"' +
            (qty === bundles ? ' checked' : '') + (qty > available ? ' disabled' : '') +
            ' aria-label="Choose ' + qty + ' Bundles of ' + U.escapeHtml(name) + '"><span>' + qty + '</span></label>'
          ).join('') + '</div><small>Available: ' + available.toLocaleString() + ' bundles</small>' +
          '<button type="button" data-saved-remove="' + index + '" aria-label="Remove ' + U.escapeHtml(name) + '">Remove</button></div>' +
          '<strong class="saved-cart-line-total">' + total + '</strong></div>';
      }).join('') + '</div><div class="saved-cart-summary"><span>' + selected.length + ' selected · ' +
        lines.length + (lines.length === 1 ? ' product saved' : ' products saved') + '</span><strong>' +
        U.pesos(cartTotal) + '</strong></div><p class="saved-cart-estimate">Estimated selected total</p>' +
        '<div class="saved-cart-actions">' +
        '<a class="btn btn-outline" href="products.html"><i class="fas fa-store"></i> Continue Browsing</a>' +
        '<button class="btn btn-primary saved-cart-cta" id="saved-cart-checkout" type="button"' + (!selected.length ? ' disabled' : '') +
        '><i class="fas fa-credit-card"></i> Check out selected</button>' +
        '</div>';
    }

    const STAGE_LABEL = {
      PAYMENT_UNDER_VERIFICATION: 'Under Verification',
      CONFIRMED: 'Confirmed',
      IN_PRODUCTION: 'In Production',
      OUT_FOR_DELIVERY: 'Out for Delivery',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
    };

    let reviewedSet = new Set();

    function renderOrders(orders, member) {
      const container = document.getElementById('dash-orders-container');
      if (!orders.length) {
        container.innerHTML = '<p class="empty-state"><i class="fas fa-box-open" style="font-size:2rem; color:#B58A44; display:block; margin-bottom:0.5rem;"></i>You haven\'t placed any orders yet.</p>';
        return;
      }

      container.innerHTML = orders.map((o) => {
        const canCancel = (o.status === 'PAYMENT_UNDER_VERIFICATION');
        const canRefund = !!o.refund || (o.status === 'CANCELLED');
        const statusText = STAGE_LABEL[o.status] || String(o.status).replace(/_/g, ' ');
        const statusClass = 'status-' + String(o.status).toLowerCase();

        // Items summary with review unlock ONLY if order is COMPLETED
        const itemsHtml = (o.items && o.items.length)
          ? '<div class="order-items-list">' + o.items.map((it) => {
              let revHtml = '';
              if (o.status === 'COMPLETED') {
                const key = o.id + '_' + it.product_id;
                if (reviewedSet.has(key)) {
                  revHtml = '<span style="display:inline-flex; align-items:center; gap:0.25rem; font-size:0.75rem; color:#10B981; font-weight:600; margin-left:0.5rem;"><i class="fas fa-check-circle"></i> Reviewed</span>';
                } else {
                  revHtml = '<button type="button" class="btn btn-outline btn-xs btn-review-item" data-rev-oid="' + o.id + '" data-rev-ocode="' + U.escapeHtml(o.order_code) + '" data-rev-pid="' + it.product_id + '" data-rev-pname="' + U.escapeHtml(it.product_name) + '" style="margin-left:0.5rem; padding:0.15rem 0.5rem; font-size:0.75rem; color:#B58A44; border-color:#B58A44;"><i class="fas fa-star" style="color:#F59E0B"></i> Leave a Review</button>';
                }
              }
              return '<div class="order-item-line"><span><strong>' + U.escapeHtml(it.product_name) + '</strong> × ' +
                Number(it.bundles).toLocaleString() + ' bundles <small>(' +
                (Number(it.bundles) * Number(it.pieces_per_bundle || 25)).toLocaleString() + ' pcs)</small>' + revHtml + '</span>' +
                '<strong>' + U.pesos(it.line_total_centavos) + '</strong></div>';
            }).join('') + '</div>'
          : '';

        // Refund status tag if exists
        let refundTag = '';
        if (o.refund) {
          refundTag = '<div class="order-refund-tag"><i class="fas fa-undo"></i> Refund: <strong>' +
            U.escapeHtml(String(o.refund.status).replace(/_/g, ' ')) + '</strong> (' + U.pesos(o.refund.amount_centavos) + ')</div>';
        }

        return '<div class="order-block" data-order-code="' + U.escapeHtml(o.order_code) + '">' +
          '<div class="order-block-header">' +
            '<div class="order-block-id">' +
              '<span class="order-icon"><i class="fas fa-receipt"></i></span>' +
              '<div>' +
                '<strong class="order-code-text">' + U.escapeHtml(o.order_code) + '</strong>' +
                '<span class="order-date-text"><i class="far fa-calendar-alt"></i> ' + U.fmtDate(o.created_at) + '</span>' +
              '</div>' +
            '</div>' +
            '<span class="order-status-badge ' + statusClass + '">' +
              '<i class="fas fa-circle" style="font-size:0.45rem"></i> ' + U.escapeHtml(statusText) +
            '</span>' +
          '</div>' +
          itemsHtml +
          '<div class="order-pricing-summary">' +
            '<div><span>Total: </span><strong>' + U.pesos(o.total_centavos) + '</strong>' +
            '<span style="margin-left:0.5rem; font-size:0.75rem; color:#8C7E75;">(Paid: ' + U.pesos(o.downpayment_paid_centavos || o.downpayment_centavos) + ')</span></div>' +
            refundTag +
          '</div>' +
          '<div class="order-block-actions">' +
            '<a href="track.html?code=' + encodeURIComponent(o.order_code) + '&email=' + encodeURIComponent(member.email) + '" class="btn btn-outline btn-sm">' +
              '<i class="fas fa-location-arrow"></i> Order Status' +
            '</a>' +
            '<button type="button" class="btn btn-outline-danger btn-sm" data-dash-cancel="' + U.escapeHtml(o.order_code) + '"' +
              (canCancel ? '' : ' disabled title="Cancellation is only permitted while payment is under verification. Once confirmed, orders cannot be cancelled."') + '>' +
              '<i class="fas fa-ban"></i> Cancel' +
            '</button>' +
            '<button type="button" class="btn btn-outline-warning btn-sm" data-dash-refund="' + U.escapeHtml(o.order_code) + '"' +
              (canRefund ? '' : ' disabled title="Refunds are not permitted once an order is confirmed."') + '>' +
              '<i class="fas fa-undo-alt"></i> Refund' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    /* ---------------- Cancel & Refund Modals ---------------- */
    const cancelModal = document.getElementById('dash-cancel-modal');
    const cancelOverlay = document.getElementById('dash-cancel-overlay');
    const refundModal = document.getElementById('dash-refund-modal');
    const refundOverlay = document.getElementById('dash-refund-overlay');

    function closeCancelModal() {
      if (cancelModal) cancelModal.classList.remove('active');
      if (cancelOverlay) cancelOverlay.classList.remove('active');
      activeCancelOrder = null;
    }
    function closeRefundModal() {
      if (refundModal) refundModal.classList.remove('active');
      if (refundOverlay) refundOverlay.classList.remove('active');
      activeRefundOrder = null;
    }

    if (cancelOverlay) cancelOverlay.addEventListener('click', closeCancelModal);
    document.getElementById('dash-cancel-close')?.addEventListener('click', closeCancelModal);
    document.getElementById('dash-cancel-back')?.addEventListener('click', closeCancelModal);

    if (refundOverlay) refundOverlay.addEventListener('click', closeRefundModal);
    document.getElementById('dash-refund-close')?.addEventListener('click', closeRefundModal);
    document.getElementById('dash-refund-back')?.addEventListener('click', closeRefundModal);

    // Order History container actions
    document.getElementById('dash-orders-container').addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('[data-dash-cancel]');
      const refundBtn = e.target.closest('[data-dash-refund]');
      if (cancelBtn && !cancelBtn.disabled) {
        const code = cancelBtn.dataset.dashCancel;
        const o = allOrders.find((ord) => ord.order_code === code);
        if (!o) return;
        activeCancelOrder = o;
        document.getElementById('cancel-order-code-display').textContent = o.order_code;
        document.getElementById('dash-cancel-reason').value = '';
        document.getElementById('dash-cancel-name').value = (currentMember && (currentMember.name || currentMember.full_name)) || '';
        document.getElementById('dash-cancel-num').value = (currentMember && currentMember.contact) || '';
        document.getElementById('dash-cancel-num2').value = (currentMember && currentMember.contact) || '';
        cancelOverlay.classList.add('active');
        cancelModal.classList.add('active');
        return;
      }
      if (cancelBtn) {
        const code = cancelBtn.dataset.dashCancel;
        const o = allOrders.find((ord) => ord.order_code === code);
        if (!o) return;
        if (o.status !== 'PAYMENT_UNDER_VERIFICATION') {
          U.toast('This order is already confirmed. Confirmed orders cannot be cancelled or refunded.');
          return;
        }
        activeCancelOrder = o;
        document.getElementById('cancel-order-code-display').textContent = o.order_code;
        document.getElementById('dash-cancel-reason').value = '';
        document.getElementById('dash-cancel-name').value = (currentMember && (currentMember.name || currentMember.full_name)) || '';
        document.getElementById('dash-cancel-num').value = (currentMember && currentMember.contact) || '';
        document.getElementById('dash-cancel-num2').value = (currentMember && currentMember.contact) || '';
        cancelOverlay.classList.add('active');
        cancelModal.classList.add('active');
        return;
      }
      if (refundBtn) {
        const code = refundBtn.dataset.dashRefund;
        const o = allOrders.find((ord) => ord.order_code === code);
        if (!o) return;
        if (o.status === 'CONFIRMED' && !o.refund) {
          U.toast('This order is already confirmed. Confirmed orders cannot be cancelled or refunded.');
          return;
        }
        activeRefundOrder = o;
        document.getElementById('refund-order-code-display').textContent = o.order_code;
        const statusCard = document.getElementById('dash-refund-status-card');
        if (o.refund) {
          statusCard.innerHTML =
            '<div style="background:#FFFBF0; border:1px solid #F5E5C9; border-radius:10px; padding:0.75rem; font-size:0.83rem;">' +
            '<div><strong>Refund Status:</strong> ' + U.escapeHtml(String(o.refund.status).replace(/_/g, ' ')) + '</div>' +
            '<div><strong>Amount:</strong> ' + U.pesos(o.refund.amount_centavos) + '</div>' +
            (o.refund.wallet_type ? '<div><strong>Registered Wallet:</strong> ' + U.escapeHtml(o.refund.wallet_type) + ' (' + U.escapeHtml(o.refund.account_number) + ')</div>' : '') +
            '</div>';
          document.getElementById('dash-refund-name').value = o.refund.account_name || (currentMember && (currentMember.name || currentMember.full_name)) || '';
          document.getElementById('dash-refund-num').value = o.refund.account_number || '';
          document.getElementById('dash-refund-num2').value = o.refund.account_number || '';
        } else {
          const canCancel = (o.status === 'PAYMENT_UNDER_VERIFICATION');
          statusCard.innerHTML =
            '<div style="background:#F0F7FF; border:1px solid #D0E3F7; border-radius:10px; padding:0.75rem; font-size:0.83rem;">' +
            '<div><strong>Order Status:</strong> ' + U.escapeHtml(STAGE_LABEL[o.status] || o.status) + '</div>' +
            '<p style="margin:0.25rem 0 0; color:#555;">' +
            (canCancel
              ? 'This order is under verification. Cancelling it will initiate a refund for your 50% downpayment (' + U.pesos(o.downpayment_paid_centavos || o.downpayment_centavos) + ').'
              : 'Refund requests are processed upon order cancellation. You can update your refund wallet details below.') +
            '</p></div>';
          document.getElementById('dash-refund-name').value = (currentMember && (currentMember.name || currentMember.full_name)) || '';
          document.getElementById('dash-refund-num').value = (currentMember && currentMember.contact) || '';
          document.getElementById('dash-refund-num2').value = (currentMember && currentMember.contact) || '';
        }
        refundOverlay.classList.add('active');
        refundModal.classList.add('active');
      }
    });

    // Enforce 11 max digits on all phone and wallet inputs
    ['dash-contact', 'dash-cancel-num', 'dash-cancel-num2', 'dash-refund-num', 'dash-refund-num2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.maxLength = 11;
        el.addEventListener('input', () => {
          el.value = el.value.replace(/\D/g, '').slice(0, 11);
        });
      }
    });

    document.getElementById('dash-cancel-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeCancelOrder) return;
      const num = document.getElementById('dash-cancel-num').value.trim();
      const num2 = document.getElementById('dash-cancel-num2').value.trim();
      if (num !== num2) {
        U.toast('The two account numbers do not match.');
        return;
      }
      const btn = document.getElementById('dash-cancel-submit-btn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...';
      try {
        const body = {
          reason: document.getElementById('dash-cancel-reason').value.trim(),
          wallet_type: document.getElementById('dash-cancel-type').value,
          account_number: num,
          account_number_confirm: num,
          account_name: document.getElementById('dash-cancel-name').value.trim(),
        };
        await api.cancelOrder(activeCancelOrder.order_code, body);
        U.toast('Order cancelled. Your refund request is now pending.');
        closeCancelModal();
        await load();
      } catch (err) {
        U.toast(err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Confirm Cancel';
      }
    });

    document.getElementById('dash-refund-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeRefundOrder) return;
      const num = document.getElementById('dash-refund-num').value.trim();
      const num2 = document.getElementById('dash-refund-num2').value.trim();
      if (num !== num2) {
        U.toast('The two account numbers do not match.');
        return;
      }
      const btn = document.getElementById('dash-refund-submit-btn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      try {
        const body = {
          wallet_type: document.getElementById('dash-refund-type').value,
          account_number: num,
          account_number_confirm: num,
          account_name: document.getElementById('dash-refund-name').value.trim(),
        };
        await api.refundDetails(activeRefundOrder.order_code, body);
        U.toast('Refund wallet details saved successfully.');
        closeRefundModal();
        await load();
      } catch (err) {
        U.toast(err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save Details';
      }
    });

    /* ---------------- Review Modal ---------------- */
    const reviewModal = document.getElementById('dash-review-modal');
    const reviewOverlay = document.getElementById('dash-review-overlay');

    function closeReviewModal() {
      if (reviewModal) reviewModal.classList.remove('active');
      if (reviewOverlay) reviewOverlay.classList.remove('active');
    }

    if (reviewOverlay) reviewOverlay.addEventListener('click', closeReviewModal);
    document.getElementById('dash-review-close')?.addEventListener('click', closeReviewModal);
    document.getElementById('dash-review-cancel-btn')?.addEventListener('click', closeReviewModal);

    const starBox = document.getElementById('dash-review-stars');
    if (starBox) {
      const starIcons = starBox.querySelectorAll('[data-star]');
      const ratingInput = document.getElementById('dash-review-rating-val');
      const setStars = (val) => {
        if (ratingInput) ratingInput.value = String(val);
        starIcons.forEach((s) => {
          const num = Number(s.dataset.star);
          s.className = num <= val ? 'fas fa-star' : 'far fa-star';
        });
      };
      starIcons.forEach((s) => {
        s.addEventListener('click', () => setStars(Number(s.dataset.star)));
      });
    }

    document.getElementById('dash-orders-container').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-review-item');
      if (!btn) return;
      document.getElementById('dash-review-order-id').value = btn.dataset.revOid;
      document.getElementById('dash-review-order-code').value = btn.dataset.revOcode;
      document.getElementById('dash-review-product-id').value = btn.dataset.revPid;
      document.getElementById('dash-review-product-name').value = btn.dataset.revPname;
      document.getElementById('dash-review-text').value = '';
      if (starBox) {
        starBox.querySelectorAll('[data-star]').forEach((s) => { s.className = 'fas fa-star'; });
      }
      if (document.getElementById('dash-review-rating-val')) {
        document.getElementById('dash-review-rating-val').value = '5';
      }
      if (reviewOverlay) reviewOverlay.classList.add('active');
      if (reviewModal) reviewModal.classList.add('active');
    });

    const dashRevForm = document.getElementById('dash-review-form');
    if (dashRevForm) {
      dashRevForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const orderId = document.getElementById('dash-review-order-id').value;
        const orderCode = document.getElementById('dash-review-order-code').value;
        const productId = document.getElementById('dash-review-product-id').value;
        const rating = Number(document.getElementById('dash-review-rating-val').value) || 5;
        const text = document.getElementById('dash-review-text').value.trim();
        const submitBtn = document.getElementById('dash-review-submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
        try {
          await api.reviewSubmit({
            order_id: Number(orderId),
            order_code: orderCode,
            product_id: Number(productId),
            rating,
            text,
            name: (currentMember && (currentMember.name || currentMember.full_name)) || '',
          });
          U.toast('Review submitted! Thank you for your feedback.');
          closeReviewModal();
          await load();
        } catch (err) {
          U.toast(err.message || 'Could not submit review.');
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Submit Review';
        }
      });
    }

    async function load() {
      const [{ member }, cartRes, ordersRes, prodRes, reviewEligRes] = await Promise.all([
        api.profile(), api.cartGet(), api.mine(), api.products(),
        api.reviewEligibility().catch(() => ({ reviewed_keys: [] })),
      ]);
      reviewedSet = new Set((reviewEligRes && reviewEligRes.reviewed_keys) || []);
      currentMember = member;
      const memberName = member.name || member.full_name || localStorage.getItem('webake_member_name') || '';
      document.getElementById('dash-name').value = memberName;
      if (memberName) localStorage.setItem('webake_member_name', memberName);
      const greetingName = document.getElementById('dashboard-member-name');
      if (greetingName) greetingName.textContent = memberName || 'there';
      document.getElementById('dash-contact').value = member.contact || '';
      document.getElementById('dash-email').value = member.email || '';
      document.getElementById('dash-address').value = member.address || '';

      // Saved cart, enriched with live catalog names/prices.
      savedCatalog = Object.fromEntries((prodRes.products || []).map((p) => [Number(p.id), p]));
      
      let serverLines = (cartRes.items || [])
        .filter((line) => !quantityOptions.length || quantityOptions.includes(Number(line.bundles)))
        .map((line) => ({ product_id: Number(line.product_id), bundles: Number(line.bundles) }));

      // If server cart is empty, check if there are items saved in localStorage to sync
      if (!serverLines.length) {
        try {
          const local = JSON.parse(localStorage.getItem('webake_cart') || '[]')
            .filter((line) => !quantityOptions.length || quantityOptions.includes(Number(line.bundles)))
            .map((line) => ({ product_id: Number(line.product_id), bundles: Number(line.bundles) }));
          if (local.length) {
            serverLines = local;
            api.cartPut(serverLines, false).catch(() => {});
          }
        } catch { /* ignore */ }
      } else {
        localStorage.setItem('webake_cart', JSON.stringify(serverLines));
      }

      // Filter out products that are archived or no longer exist
      serverLines = serverLines.filter((line) => {
        const prod = savedCatalog[Number(line.product_id)];
        return prod && !prod.is_archived;
      });

      savedCartLines = serverLines;
      selectedSavedIds = new Set(savedCartLines.map((line) => line.product_id));
      renderSavedCart();

      // Order history with 1-block component, cancel and refund buttons.
      allOrders = ordersRes.orders || [];
      renderOrders(allOrders, member);
    }

    load().catch((err) => {
      // Dead token: bounce to login (ShopAPI has no 401 redirect for shoppers).
      if (err.status === 401) {
        window.ShopAuth.clear();
        window.location.href = 'home.html?auth=login&next=dashboard.html';
        return;
      }
      U.toast(err.message);
    });
  });
})(window, document);
