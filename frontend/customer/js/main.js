/**
 * Shop + cart + checkout (main.js). Runs the products page end to end.
 *
 * WHAT: Catalog render, product modal (bundles), cart sidebar (guest
 * localStorage / member DB sync), and the 5-step checkout: stock sanity ->
 * info -> OTP (skipped for members using their own email) -> create order +
 * submit payment -> success receipt. Minimum-order and ref-length rules are
 * enforced client-side for speed AND server-side for truth.
 */
(function (window, document) {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('product-grid')) return; // products page only

    const U = window.WeBakeUtils;
    const t = (k, v) => window.WB_I18N.t(k, v);
    const api = window.ShopAPI;
    const auth = window.ShopAuth;
    // The shop stores bundle quantities in the API. One customer-facing order
    // unit is 300 bundles; keeping the conversion here preserves that contract.
    const BUNDLES_PER_ORDER_UNIT = 300;

    let catalog = [];
    let cart = [];
    let selectedProductIds = new Set();
    let settings = { min_order_bundles: '300' };
    let memberEmail = '';
    let minBundles = 300;
    let persistTimer = null;

    const co = { // checkout session state
      name: '', email: '', contact: '', address: '',
      method: 'GCASH', order: null, key: null,
      items: [],
    };

    /* ---------------- load ---------------- */

    async function init() {
      relabelStatic();
      const [prodRes, setRes] = await Promise.all([
        api.products(), api.settingsPublic().catch(() => ({ settings: {} })),
      ]);
      catalog = (prodRes.products || []).filter((p) => !p.is_archived);
      settings = Object.assign(settings, setRes.settings || {});
      minBundles = Math.max(1, parseInt(settings.min_order_bundles, 10) || 300);
      showMinNote();

      if (auth.token()) {
        try {
          const [cartRes, profRes] = await Promise.all([api.cartGet(), api.profile()]);
          cart = sanitize(cartRes.items || []);
          memberEmail = (profRes.member && profRes.member.email) || '';
        } catch {
          cart = loadGuest();
        }
      } else {
        cart = loadGuest();
      }
      const requestedIds = new URLSearchParams(window.location.search).get('selected');
      const requested = requestedIds ? requestedIds.split(',').map(Number).filter(Number.isFinite) : [];
      selectedProductIds = new Set(requested.length
        ? requested.filter((id) => cart.some((line) => line.product_id === id))
        : cart.map((line) => line.product_id));
      if (requestedIds) {
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        openCart();
      }
      renderGrid();
      renderCart();
    }

    function sanitize(lines) {
      const ids = new Set(catalog.map((p) => p.id));
      return (lines || []).filter((l) => ids.has(Number(l.product_id)) &&
        Number.isInteger(Number(l.bundles)) && Number(l.bundles) > 0)
        .map((l) => ({ product_id: Number(l.product_id), bundles: Number(l.bundles) }));
    }

    function loadGuest() {
      try {
        return sanitize(JSON.parse(localStorage.getItem('webake_cart') || '[]'));
      } catch { return []; }
    }

    function persist() {
      if (!auth.token()) {
        localStorage.setItem('webake_cart', JSON.stringify(cart));
        return;
      }
      // Debounced server sync: rapid +/- taps send one request.
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        api.cartPut(cart, false).catch(() => {});
      }, 600);
    }

    /* ---------------- catalog + modal ---------------- */

    function byId(id) {
      return catalog.find((p) => Number(p.id) === Number(id));
    }

    function stockNote(p) {
      if (p.stock_pieces <= 0) return t('shop.out');
      if (p.stock_status === 'LOW_STOCK') return t('shop.low') + ' (' + p.bundles_available + ')';
      return p.bundles_available + ' ' + t('shop.bundles');
    }

    function renderGrid() {
      document.getElementById('product-grid').innerHTML = catalog.map((p) =>
        '<div class="product-card" data-open="' + p.id + '">' +
        '<div class="product-img">' +
        (p.image_url ? '<img src="' + U.escapeHtml(p.image_url) + '" alt="' + U.escapeHtml(p.name) + '">' : '<i class="fas fa-bread-slice"></i>') +
        '</div><h4>' + U.escapeHtml(p.name) + '</h4>' +
        '<p class="product-price">' + U.pesos(p.price_bundle_centavos) + t('shop.per_bundle') + '</p>' +
        '<p class="product-stock">' + U.escapeHtml(stockNote(p)) + '</p>' +
        '</div>'
      ).join('') || '<p class="muted">No products available.</p>';
    }

    let modalProduct = null;

    document.getElementById('product-grid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-open]');
      if (card) openModal(card.dataset.open);
    });

    function openModal(id) {
      const p = byId(id);
      if (!p) return;
      modalProduct = p;
      document.getElementById('modal-name').textContent = p.name;
      document.getElementById('modal-desc').textContent = p.description || '';
      document.getElementById('modal-price').textContent =
        U.pesos(p.price_bundle_centavos * BUNDLES_PER_ORDER_UNIT) + ' per order quantity · ' +
        U.pesos(p.price_bundle_centavos) + t('shop.per_bundle') +
        ' (' + p.pieces_per_bundle + ' pcs each)';
      const imgBox = document.querySelector('.modal-product-img');
      imgBox.innerHTML = p.image_url
        ? '<img src="' + U.escapeHtml(p.image_url) + '" alt="' + U.escapeHtml(p.name) + '">'
        : '<i class="fas fa-image"></i><span>No image added</span>';
      const qty = document.getElementById('qty-input');
      qty.max = Math.max(1, Math.floor((p.bundles_available || 0) / BUNDLES_PER_ORDER_UNIT));
      qty.value = 1;
      const canOrder = Number(p.bundles_available || 0) >= BUNDLES_PER_ORDER_UNIT;
      document.getElementById('add-to-cart-btn').disabled = !canOrder;
      document.getElementById('buy-now-btn').disabled = !canOrder;
      document.querySelector('.quantity-label').textContent = 'Order quantity';
      document.getElementById('modal-unit-note').textContent =
        (canOrder
          ? '1 order quantity = ' + BUNDLES_PER_ORDER_UNIT + ' bundles × ' +
            (p.pieces_per_bundle || 25) + ' pcs = ' + BUNDLES_PER_ORDER_UNIT * (p.pieces_per_bundle || 25) + ' pcs'
          : 'Not enough stock for one order quantity (' + BUNDLES_PER_ORDER_UNIT + ' bundles required).');
      document.getElementById('modal-overlay').classList.add('active');
      document.getElementById('product-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('modal-overlay').classList.remove('active');
      document.getElementById('product-modal').classList.remove('active');
    }

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', closeModal);
    document.getElementById('qty-minus').addEventListener('click', () => stepQty(-1));
    document.getElementById('qty-plus').addEventListener('click', () => stepQty(1));

    function stepQty(d) {
      const qty = document.getElementById('qty-input');
      qty.value = Math.min(Number(qty.max || 100000), Math.max(1, Number(qty.value || 1) + d));
    }

    document.getElementById('add-to-cart-btn').addEventListener('click', () => {
      addLine(modalProduct.id, Number(document.getElementById('qty-input').value));
      closeModal();
      openCart();
    });
    document.getElementById('buy-now-btn').addEventListener('click', () => {
      addLine(modalProduct.id, Number(document.getElementById('qty-input').value));
      selectedProductIds = new Set([Number(modalProduct.id)]);
      renderCart();
      closeModal();
      startCheckout();
    });

    function addLine(productId, orderUnits) {
      const found = cart.find((l) => l.product_id === Number(productId));
      const actualBundles = orderUnits * BUNDLES_PER_ORDER_UNIT;
      if (found) found.bundles += actualBundles;
      else cart.push({ product_id: Number(productId), bundles: actualBundles });
      selectedProductIds.add(Number(productId));
      persist();
      renderCart();
    }

    /* ---------------- cart sidebar ---------------- */

    function totals(lines = cart) {
      let bundles = 0;
      let total = 0;
      for (const l of lines) {
        const p = byId(l.product_id);
        if (!p) continue;
        bundles += l.bundles;
        total += l.bundles * p.price_bundle_centavos;
      }
      return { bundles, total };
    }

    function openCart() {
      document.getElementById('cart-overlay').classList.add('active');
      document.getElementById('cart-sidebar').classList.add('active');
    }
    function closeCart() {
      document.getElementById('cart-overlay').classList.remove('active');
      document.getElementById('cart-sidebar').classList.remove('active');
    }

    document.getElementById('cart-icon').addEventListener('click', openCart);
    document.getElementById('cart-close').addEventListener('click', closeCart);
    document.getElementById('cart-overlay').addEventListener('click', closeCart);
    document.getElementById('continue-browsing').addEventListener('click', closeCart);

    function renderCart() {
      const box = document.getElementById('cart-items');
      box.innerHTML = cart.length ? cart.map((l, i) => {
        const p = byId(l.product_id);
        const name = p ? p.name : '#' + l.product_id;
        const line = p ? l.bundles * p.price_bundle_centavos : 0;
        const units = l.bundles / BUNDLES_PER_ORDER_UNIT;
        const pieces = l.bundles * (p ? Number(p.pieces_per_bundle || 25) : 25);
        return '<div class="cart-line' + (selectedProductIds.has(l.product_id) ? ' is-selected' : '') + '">' +
          '<label class="cart-line-select"><input type="checkbox" data-cselect="' + l.product_id + '"' +
          (selectedProductIds.has(l.product_id) ? ' checked' : '') + ' aria-label="Select ' + U.escapeHtml(name) + ' for checkout">' +
          '<span class="cart-line-product"><strong>' + U.escapeHtml(name) + '</strong><small>' +
          (Number.isInteger(units) ? units + ' order unit' + (units === 1 ? '' : 's') + ' · ' : '') +
          l.bundles + ' bundles · ' + pieces.toLocaleString() + ' pcs</small></span></label>' +
          '<div class="cart-line-ctrl">' +
          '<button type="button" data-cdec="' + i + '" aria-label="Remove one order quantity">−</button>' +
          '<span class="cart-order-qty">' + (Number.isInteger(units) ? units : l.bundles) + '</span>' +
          '<button type="button" data-cinc="' + i + '" aria-label="Add one order quantity">+</button>' +
          '<button type="button" data-cdel="' + i + '" aria-label="Remove ' + U.escapeHtml(name) + '">×</button></div>' +
          '<div><strong>' + U.pesos(line) + '</strong></div></div>';
      }).join('') : '<p class="empty-state">' + t('cart.empty') + '</p>';
      const selected = selectedLines();
      const { bundles, total } = totals(selected);
      const badge = document.getElementById('cart-count');
      badge.textContent = cart.length;
      badge.hidden = !cart.length;
      badge.setAttribute('aria-label', cart.length + ' product' + (cart.length === 1 ? '' : 's') + ' in cart');
      document.getElementById('cart-total').textContent = U.pesos(total);
      document.getElementById('cart-selected-label').textContent =
        selected.length + ' product' + (selected.length === 1 ? '' : 's') + ' selected · ' + bundles.toLocaleString() + ' bundles';
      const checkout = document.getElementById('proceed-checkout');
      checkout.disabled = selected.length === 0;
      checkout.innerHTML = '<i class="fas fa-credit-card"></i> Checkout selected (' + selected.length + ')';
    }

    function selectedLines() { return cart.filter((line) => selectedProductIds.has(line.product_id)); }

    document.getElementById('cart-items').addEventListener('click', (e) => {
      const inc = e.target.closest('[data-cinc]');
      const dec = e.target.closest('[data-cdec]');
      const del = e.target.closest('[data-cdel]');
      const select = e.target.closest('[data-cselect]');
      let removedProductId = null;
      if (select) {
        const id = Number(select.dataset.cselect);
        if (select.checked) selectedProductIds.add(id);
        else selectedProductIds.delete(id);
        renderCart();
        return;
      }
      if (inc) cart[inc.dataset.cinc].bundles += BUNDLES_PER_ORDER_UNIT;
      if (dec) {
        const l = cart[dec.dataset.cdec];
        l.bundles -= BUNDLES_PER_ORDER_UNIT;
        if (l.bundles <= 0) {
          removedProductId = l.product_id;
          cart.splice(dec.dataset.cdec, 1);
        }
      }
      if (del) {
        removedProductId = cart[del.dataset.cdel].product_id;
        cart.splice(del.dataset.cdel, 1);
      }
      if (removedProductId !== null) selectedProductIds.delete(removedProductId);
      if (inc || dec || del) { persist(); renderCart(); }
    });

    function showMinNote() {
      const sub = document.querySelector('.products-page .section-subtitle');
      if (sub && !document.getElementById('min-order-note')) {
        const p = document.createElement('p');
        p.id = 'min-order-note';
        p.className = 'min-order-note';
        p.textContent = t('shop.min_note', { n: minBundles });
        sub.after(p);
      }
    }

    /* ---------------- checkout ---------------- */

    function gotoStep(id) {
      document.querySelectorAll('.checkout-step').forEach((s) => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }
    function openCheckout() {
      document.getElementById('checkout-overlay').classList.add('active');
    }
    function closeCheckout() {
      document.getElementById('checkout-overlay').classList.remove('active');
    }

    document.getElementById('proceed-checkout').addEventListener('click', () => {
      if (!selectedLines().length) { U.toast('Select at least one product to check out.'); return; }
      const { bundles } = totals(selectedLines());
      if (bundles < minBundles) {
        U.toast(t('co.below_min', { n: minBundles, have: bundles }));
        return;
      }
      closeCart();
      startCheckout();
    });

    function startCheckout() {
      co.items = selectedLines().map((line) => ({ ...line }));
      const { bundles } = totals(co.items);
      if (!co.items.length || bundles < minBundles) {
        U.toast(t('co.below_min', { n: minBundles, have: bundles }));
        return;
      }
      co.key = U.uid();
      co.order = null;
      openCheckout();
      gotoStep('step-stock');
      // Client-side stock sanity (the SERVER re-checks at approval).
      window.setTimeout(() => {
        const short = co.items.find((l) => {
          const p = byId(l.product_id);
          return !p || l.bundles > (p.bundles_available || 0);
        });
        if (short) {
          closeCheckout();
          openCart();
          U.toast(t('co.stock_fail'));
          return;
        }
        prefillInfo();
        gotoStep('step-info');
      }, 600);
    }

    async function prefillInfo() {
      if (!auth.token()) return;
      try {
        const { member: m } = await api.profile();
        if (!m) return;
        setVal('cust-name', m.full_name);
        setVal('cust-contact', m.contact);
        setVal('cust-email', m.email);
        setVal('cust-address', m.address);
        memberEmail = m.email || '';
      } catch { /* guest flow continues */ }
    }

    function setVal(id, v) {
      const el = document.getElementById(id);
      if (el && v) el.value = v;
    }

    document.getElementById('info-back-btn').addEventListener('click', () => {
      closeCheckout();
      openCart();
    });

    // OTP widget for the checkout step.
    let otpWidget = null;
    function ensureOtp() {
      if (otpWidget) return otpWidget;
      otpWidget = window.OtpWidget.attach({
        root: '#step-otp',
        timerWrap: '#checkout-otp-timer-wrap',
        timerEl: '#checkout-otp-timer',
        resendBtn: '#checkout-otp-resend-btn',
        onVerify: verifyCheckoutOtp,
        onResend: () => sendCheckoutOtp(true),
      });
      return otpWidget;
    }

    document.getElementById('info-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      co.name = document.getElementById('cust-name').value.trim();
      co.contact = document.getElementById('cust-contact').value.trim();
      co.email = document.getElementById('cust-email').value.trim().toLowerCase();
      co.address = document.getElementById('cust-address').value.trim();
      // Members ordering with their own verified email skip the OTP step.
      if (auth.token() && memberEmail &&
          memberEmail.toLowerCase() === co.email) {
        await createOrderThenPayment();
        return;
      }
      ensureOtp().clear();
      document.getElementById('checkout-otp-email-display').textContent = co.email;
      gotoStep('step-otp');
      await sendCheckoutOtp(false);
    });

    document.getElementById('otp-back-btn').addEventListener('click', () => gotoStep('step-info'));
    document.getElementById('otp-verify-btn').addEventListener('click', () => {
      verifyCheckoutOtp(ensureOtp().code());
    });

    async function sendCheckoutOtp(isResend) {
      try {
        await api.otpSend(co.email, 'CHECKOUT');
        ensureOtp().cooldown(60);
        if (!isResend) U.toast(t('co.otp_sent', { email: co.email }));
      } catch (err) {
        showOtpError(err.message);
      }
    }

    function showOtpError(msg) {
      const el = document.getElementById('otp-error');
      el.textContent = msg;
      el.style.display = 'block';
      window.setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    async function verifyCheckoutOtp(code) {
      if (!code || code.length !== 6) { showOtpError(t('co.otp_bad')); return; }
      try {
        await api.otpVerify(co.email, 'CHECKOUT', code);
        await createOrderThenPayment();
      } catch (err) {
        ensureOtp().clear();
        showOtpError(err.message);
      }
    }

    /* ---------------- order create + payment ---------------- */

    /** Create the order, then reveal the payment step with SERVER amounts. */
    async function createOrderThenPayment() {
      gotoStep('step-stock'); // reuse the loader look while creating
      try {
        const body = {
          customer: { name: co.name, email: co.email, contact: co.contact, address: co.address },
          items: co.items.map((l) => ({ product_id: l.product_id, bundles: l.bundles })),
          payment_method: co.method,
          idempotency_key: co.key,
        };
        const token = auth.token() || undefined;
        const { order } = await api.createOrder(body, token);
        co.order = order;
        renderReview();
        setMethod(co.method);
        gotoStep('step-payment');
      } catch (err) {
        gotoStep(auth.token() && memberEmail.toLowerCase() === co.email ? 'step-info' : 'step-otp');
        U.toast(err.message);
      }
    }

    function estimate() {
      const { bundles, total } = totals(co.items);
      const down = Math.ceil(total / 2);
      return { bundles, total, down, balance: total - down };
    }

    function renderReview() {
      const o = co.order;
      const lines = co.items.map((l) => {
        const p = byId(l.product_id);
        const units = l.bundles / BUNDLES_PER_ORDER_UNIT;
        return '<div class="review-line"><span>' + U.escapeHtml(p ? p.name : '#' + l.product_id) +
          ' × ' + (Number.isInteger(units) ? units + ' order unit' + (units === 1 ? '' : 's') : l.bundles + ' bundles') +
          ' (' + l.bundles + ' bundles)</span><span>' +
          U.pesos(p ? l.bundles * p.price_bundle_centavos : 0) + '</span></div>';
      }).join('');
      document.getElementById('review-details').innerHTML =
        lines +
        '<div class="review-line"><span>Total</span><strong>' + U.pesos(o.total_centavos) + '</strong></div>' +
        '<div class="review-line highlight"><span>' + t('co.down_due') + '</span><strong>' +
        U.pesos(o.downpayment_centavos) + '</strong></div>' +
        '<div class="review-line"><span>' + t('co.balance_later') + '</span><span>' +
        U.pesos(o.balance_due_centavos) + '</span></div>' +
        '<div class="review-line"><span>Order</span><strong>' + U.escapeHtml(o.order_code) + '</strong></div>';
    }

    function qrSrc(which) {
      const raw = which === 'GCASH' ? settings.gcash_qr : settings.paymaya_qr;
      if (!raw) return '';
      if (/^(https?:|\/|data:|\.\.\/)/.test(raw)) return raw;
      return '../../' + raw; // stored root-relative, page sits in customer/html/
    }

    function setMethod(method) {
      co.method = method;
      const isGcash = method === 'GCASH';
      document.getElementById('payment-method').value = isGcash ? 'GCash' : 'PayMaya';
      document.getElementById('btn-method-gcash').classList.toggle('active-gcash', isGcash);
      document.getElementById('btn-method-maya').classList.toggle('active-maya', !isGcash);
      document.getElementById('qr-brand-label').textContent = isGcash ? 'GCash' : 'Maya';
      document.getElementById('ref-field-label').textContent = isGcash ? 'GCash' : 'Maya';
      document.getElementById('qr-num-display').textContent =
        isGcash ? (settings.gcash_number || '-') : (settings.paymaya_number || '-');
      document.getElementById('qr-name-display').textContent = settings.account_name || '-';
      const img = document.getElementById('payment-qr-img');
      const src = qrSrc(method);
      img.style.display = src ? '' : 'none';
      if (src) img.src = src;
      const ref = document.getElementById('gcash-ref');
      ref.value = '';
      ref.maxLength = isGcash ? 13 : 16;
      ref.placeholder = isGcash ? 'e.g. 1000123456789 (13 digits)' : 'e.g. 1000123456789012 (16 digits)';
    }

    document.getElementById('btn-method-gcash').addEventListener('click', () => setMethod('GCASH'));
    document.getElementById('btn-method-maya').addEventListener('click', () => setMethod('MAYA'));
    document.getElementById('copy-acc-btn').addEventListener('click', async () => {
      const num = document.getElementById('qr-num-display').textContent.replace(/\s/g, '');
      try {
        await navigator.clipboard.writeText(num);
        document.getElementById('copy-btn-text').textContent = 'Copied';
        window.setTimeout(() => { document.getElementById('copy-btn-text').textContent = 'Copy'; }, 1500);
      } catch { /* clipboard unavailable; number is visible anyway */ }
    });
    document.getElementById('payment-back-btn').addEventListener('click', () => gotoStep('step-info'));

    function payError(msg) {
      const el = document.getElementById('payment-error-msg');
      if (!msg) { el.style.display = 'none'; return; }
      el.textContent = msg;
      el.style.display = 'block';
    }

    document.getElementById('pay-btn').addEventListener('click', async (e) => {
      payError(null);
      const ref = document.getElementById('gcash-ref').value.trim();
      const expected = co.method === 'GCASH' ? 13 : 16;
      if (!/^\d+$/.test(ref) || ref.length !== expected) {
        payError(co.method === 'GCASH'
          ? 'Please enter a valid 13-digit GCash reference number (numbers only).'
          : 'Please enter a valid 16-digit Maya reference number (numbers only).');
        return;
      }
      const file = document.getElementById('gcash-proof').files[0];
      if (!file) { payError('Please upload your payment screenshot.'); return; }
      if (file.size > 5 * 1024 * 1024) { payError('Screenshot must be 5MB or smaller.'); return; }

      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        // The method may have changed after order creation: recreate is
        // unnecessary (method is informational until payment) - but if the
        // order was never created (member skip path failed), create it now.
        if (!co.order) {
          await createOrderThenPayment();
          if (!co.order) return;
        }
        const form = new FormData();
        form.append('channel', co.method);
        form.append('reference_number', ref);
        // Guests identify with email; members with their token (unless the
        // order email differs from the member email - then email too).
        const sameMember = auth.token() && memberEmail &&
          memberEmail.toLowerCase() === co.email;
        if (!sameMember) form.append('email', co.email);
        form.append('proof', file);
        await api.submitPayment(co.order.order_code, form, auth.token() || undefined);
        showSuccess();
      } catch (err) {
        payError(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    /* ---------------- success ---------------- */

    function showSuccess() {
      const o = co.order;
      document.getElementById('success-order-id-card').innerHTML =
        '<div class="success-id-card"><span>Order ID</span><strong>' + U.escapeHtml(o.order_code) +
        '</strong><a href="track.html?code=' + encodeURIComponent(o.order_code) +
        '">Track this order</a></div>';
      document.getElementById('success-downpayment-summary').innerHTML =
        '<div class="success-summary"><div class="review-line"><span>Downpayment submitted</span><strong>' +
        U.pesos(o.downpayment_centavos) + '</strong></div>' +
        '<div class="review-line"><span>Balance on delivery</span><span>' +
        U.pesos(o.balance_due_centavos) + '</span></div>' +
        '<p class="pending-note">' + t('co.submit_pay') + '</p></div>';
      document.getElementById('success-guest-convert-box').innerHTML = auth.token() ? '' :
        '<div class="guest-convert"><p>Have an account? Your orders link automatically when you register with ' +
        U.escapeHtml(co.email) + '.</p><a class="btn btn-outline btn-sm" href="register.html?email=' +
        encodeURIComponent(co.email) + '">Create account</a></div>';
      gotoStep('step-success');
      // Keep unchecked products in the saved cart after placing this order.
      const checkedOutIds = new Set(co.items.map((line) => line.product_id));
      cart = cart.filter((line) => !checkedOutIds.has(line.product_id));
      checkedOutIds.forEach((id) => selectedProductIds.delete(id));
      persist();
      renderCart();
    }

    document.getElementById('order-again-btn').addEventListener('click', () => {
      document.getElementById('gcash-ref').value = '';
      document.getElementById('gcash-proof').value = '';
      co.order = null;
      closeCheckout();
      init().catch(() => {});
    });
    document.getElementById('success-nav-btn').addEventListener('click', closeCheckout);

    /* ---------------- static English labels ---------------- */

    function relabelStatic() {
      const setHtml = (id, icon, key) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<i class="' + icon + '"></i> ' + t(key);
      };
      setHtml('proceed-checkout', 'fas fa-credit-card', 'cart.checkout');
      setHtml('continue-browsing', 'fas fa-arrow-left', 'cart.continue');
      setHtml('add-to-cart-btn', 'fas fa-cart-plus', 'shop.add');
      setHtml('buy-now-btn', 'fas fa-bolt', 'shop.buy_now');
      const otpTitle = document.querySelector('#step-otp .auth-modal-title');
      if (otpTitle) otpTitle.textContent = t('co.verify_email');
    }

    init().catch((err) => {
      document.getElementById('product-grid').innerHTML =
        '<p class="error-text">' + U.escapeHtml(err.message) + '</p>';
    });
  });
})(window, document);
