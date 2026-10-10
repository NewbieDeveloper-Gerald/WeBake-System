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

    const U = window.WeBakeUtils;
    const t = (k, v) => window.WB_I18N.t(k, v);
    const api = window.ShopAPI;
    const auth = window.ShopAuth;
    let catalog = [];
    const quantityOptions = window.WEBAKE_ORDER_QUANTITY_OPTIONS || [];
    let modalQuantity = null;
    let cart = [];
    let selectedProductIds = new Set();
    let settings = { min_order_bundles: '300' };
    let memberEmail = '';
    let minBundles = 300;
    let cartWriteQueue = Promise.resolve();
    let isDirectSingleCheckout = false;

    const co = { // checkout session state
      name: '', email: '', contact: '', address: '',
      method: 'GCASH', order: null, key: null,
      items: [],
    };

    /* ---------------- load ---------------- */

    async function init() {
      relabelStatic();
      const [prodRes, setRes] = await Promise.all([
        api.products(), api.settingsPublic(),
      ]);
      catalog = (prodRes.products || []).filter((p) => !p.is_archived);
      settings = Object.assign(settings, setRes.settings || {});
      minBundles = Math.max(1, parseInt(settings.min_order_bundles, 10) || 300);
      showMinNote();
      if (document.getElementById('payment-method')) setMethod('GCASH');
      loadReviews().catch(() => {});

      if (auth.token()) {
        try {
          const [cartRes, profRes] = await Promise.all([api.cartGet(), api.profile()]);
          let serverLines = sanitize(cartRes.items || []);
          if (!serverLines.length) {
            const guestLines = loadGuest();
            if (guestLines.length) {
              serverLines = guestLines;
              api.cartPut(serverLines, false).catch(() => {});
            }
          }
          cart = serverLines;
          localStorage.setItem('webake_cart', JSON.stringify(cart));
          memberEmail = (profRes.member && profRes.member.email) || '';
        } catch {
          cart = loadGuest();
        }
      } else {
        cart = loadGuest();
      }
      const params = new URLSearchParams(window.location.search);
      const requestedIds = params.get('selected');
      const checkoutRequested = params.get('checkout') === '1';
      const requested = requestedIds ? requestedIds.split(',').map(Number).filter(Number.isFinite) : [];
      selectedProductIds = new Set(requested.length
        ? requested.filter((id) => cart.some((line) => line.product_id === id))
        : cart.map((line) => line.product_id));
      if (requestedIds) {
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      }
      renderGrid();
      renderCart();
      if (checkoutRequested && selectedProductIds.size) startCheckout();
      else if (requestedIds) openCart();
    }

    function sanitize(lines) {
      // Product ids arrive from the API as STRINGS (PostgreSQL BIGINT is
      // serialized as text), while cart lines always store NUMBERS. Compare
      // like with like, or every saved line fails the lookup and the whole
      // cart is silently emptied on every page load.
      const ids = new Set(catalog.map((p) => Number(p.id)));
      return (lines || []).filter((l) => ids.has(Number(l.product_id)) &&
        Number.isInteger(Number(l.bundles)) && Number(l.bundles) > 0 &&
        (!quantityOptions.length || quantityOptions.includes(Number(l.bundles))))
        .map((l) => ({ product_id: Number(l.product_id), bundles: Number(l.bundles) }));
    }

    function loadGuest() {
      try {
        return sanitize(JSON.parse(localStorage.getItem('webake_cart') || '[]'));
      } catch { return []; }
    }

    function persist() {
      // Keep localStorage in sync immediately as local cache and backup
      localStorage.setItem('webake_cart', JSON.stringify(cart));
      if (!auth.token()) return;

      // Save each updated snapshot to the member account in Supabase
      const snapshot = cart.map((line) => ({ product_id: Number(line.product_id), bundles: Number(line.bundles) }));
      cartWriteQueue = cartWriteQueue
        .catch(() => {})
        .then(() => api.cartPut(snapshot, false))
        .catch(() => U.toast('Your cart could not be saved to your account. Please try again.'));
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
      const grid = document.getElementById('product-grid');
      if (!grid) return;
      grid.innerHTML = catalog.map((p) =>
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

    const prodGrid = document.getElementById('product-grid');
    if (prodGrid) {
      prodGrid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-open]');
        if (card) openModal(card.dataset.open);
      });
    }

    function openModal(id) {
      const p = byId(id);
      if (!p) return;
      modalProduct = p;
      const mName = document.getElementById('modal-name');
      if (mName) mName.textContent = p.name;
      const mDesc = document.getElementById('modal-desc');
      if (mDesc) mDesc.textContent = p.description || '';
      const mPrice = document.getElementById('modal-price');
      if (mPrice) mPrice.textContent =
        U.pesos(p.price_bundle_centavos) + t('shop.per_bundle') +
        ' (' + p.pieces_per_bundle + ' pcs each)';
      const imgBox = document.querySelector('.modal-product-img');
      if (imgBox) {
        imgBox.innerHTML = p.image_url
          ? '<img src="' + U.escapeHtml(p.image_url) + '" alt="' + U.escapeHtml(p.name) + '">'
          : '<i class="fas fa-image"></i><span>No image added</span>';
      }
      modalQuantity = null;
      const qOptions = document.getElementById('quantity-options');
      if (qOptions) renderQuantityOptions(qOptions, p, null, 'product');
      const qStock = document.getElementById('quantity-stock');
      if (qStock) qStock.textContent = 'Available stock: ' +
        Number(p.bundles_available || 0).toLocaleString() + ' bundles';
      const qTotal = document.getElementById('quantity-total');
      if (qTotal) qTotal.textContent = 'Select a quantity to see the total.';
      const qErr = document.getElementById('quantity-error');
      if (qErr) qErr.hidden = true;
      const addBtn = document.getElementById('add-to-cart-btn');
      if (addBtn) addBtn.disabled = quantityOptions.length === 0;
      const buyBtn = document.getElementById('buy-now-btn');
      if (buyBtn) buyBtn.disabled = quantityOptions.length === 0;

      const reviewBar = document.getElementById('product-modal-review-bar');
      if (reviewBar) {
        if (!auth.token()) {
          reviewBar.innerHTML = '<p style="font-size:0.83rem; color:#8C7E75; margin:0;"><i class="fas fa-info-circle"></i> You can review this product after your order is completed.</p>';
        } else {
          reviewBar.innerHTML = '<p style="font-size:0.83rem; color:#8C7E75; margin:0;"><i class="fas fa-spinner fa-spin"></i> Checking review eligibility...</p>';
          api.reviewEligibility(p.id).then((res) => {
            if (res.eligible && res.available && res.available.length) {
              const eligibleOrder = res.available[0];
              reviewBar.innerHTML = '<button type="button" class="btn btn-outline btn-sm btn-block" id="btn-prod-modal-review" style="color:#B58A44; border-color:#B58A44; padding:0.4rem 0.8rem;"><i class="fas fa-star" style="color:#F59E0B"></i> Leave a Review for this Product</button>';
              document.getElementById('btn-prod-modal-review').addEventListener('click', () => {
                closeModal();
                openReviewModalWith({
                  order_id: eligibleOrder.order_id,
                  order_code: eligibleOrder.order_code,
                  product_id: p.id,
                  product_name: p.name,
                });
              });
            } else {
              reviewBar.innerHTML = '<p style="font-size:0.83rem; color:#8C7E75; margin:0;"><i class="fas fa-info-circle"></i> ' +
                U.escapeHtml(res.message || 'You can review this product after your order is completed.') + '</p>';
            }
          }).catch(() => {
            reviewBar.innerHTML = '<p style="font-size:0.83rem; color:#8C7E75; margin:0;"><i class="fas fa-info-circle"></i> You can review this product after your order is completed.</p>';
          });
        }
      }

      const mo = document.getElementById('modal-overlay');
      if (mo) mo.classList.add('active');
      const pm = document.getElementById('product-modal');
      if (pm) pm.classList.add('active');
    }

    function closeModal() {
      const mo = document.getElementById('modal-overlay');
      if (mo) mo.classList.remove('active');
      const pm = document.getElementById('product-modal');
      if (pm) pm.classList.remove('active');
    }

    const modalClose = document.getElementById('modal-close');
    if (modalClose) modalClose.addEventListener('click', closeModal);
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) modalOverlay.addEventListener('click', closeModal);

    const qOptions = document.getElementById('quantity-options');
    if (qOptions) {
      qOptions.addEventListener('change', (e) => {
        if (!e.target.matches('[data-product-quantity]')) return;
        modalQuantity = Number(e.target.value);
        const qErr = document.getElementById('quantity-error');
        if (qErr) qErr.hidden = true;
        const qTot = document.getElementById('quantity-total');
        if (qTot && modalProduct) {
          qTot.textContent = 'Total: ' + U.pesos(modalQuantity * modalProduct.price_bundle_centavos);
        }
      });
      qOptions.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.matches('input[type="radio"]')) return;
        e.preventDefault();
        e.target.checked = true;
        e.target.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    function renderQuantityOptions(container, product, selected, scope) {
      if (!quantityOptions.length) {
        container.innerHTML = '<p class="quantity-error" role="alert">Quantity choices are unavailable. Refresh the page and try again.</p>';
        return;
      }
      const available = Number(product.bundles_available || 0);
      container.innerHTML = quantityOptions.map((qty) =>
        '<label class="quantity-option' + (qty === selected ? ' selected' : '') +
        (qty > available ? ' unavailable' : '') + '"><input type="radio" name="' + scope + '-quantity-' +
        product.id + '" value="' + qty + '" data-' + scope + '-quantity="' + product.id + '"' +
        (qty === selected ? ' checked' : '') + (qty > available ? ' disabled' : '') +
        ' aria-label="' + qty + ' Bundles" aria-describedby="quantity-stock">' +
        '<span>' + qty + ' Bundles</span></label>'
      ).join('');
    }

    function selectedModalQuantity() {
      if (!modalProduct || !modalQuantity || !quantityOptions.includes(modalQuantity) ||
          modalQuantity > Number(modalProduct.bundles_available || 0)) {
        const qErr = document.getElementById('quantity-error');
        if (qErr) qErr.hidden = false;
        return null;
      }
      return modalQuantity;
    }

    const addBtn = document.getElementById('add-to-cart-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const qty = selectedModalQuantity();
        if (!qty) return;
        addLine(modalProduct.id, qty);
        closeModal();
        U.toast('Added to cart.');
      });
    }
    const buyBtn = document.getElementById('buy-now-btn');
    if (buyBtn) {
      buyBtn.addEventListener('click', () => {
        const qty = selectedModalQuantity();
        if (!qty) return;
        isDirectSingleCheckout = true;
        addLine(modalProduct.id, qty);
        selectedProductIds = new Set([Number(modalProduct.id)]);
        renderCart();
        closeModal();
        startCheckout();
      });
    }

    function addLine(productId, bundles) {
      const found = cart.find((l) => l.product_id === Number(productId));
      if (found) found.bundles = bundles;
      else cart.push({ product_id: Number(productId), bundles });
      selectedProductIds.add(Number(productId));
      persist();
      renderCart();
      const badge = document.getElementById('cart-count');
      if (badge) {
        badge.classList.remove('pop');
        void badge.offsetWidth;
        badge.classList.add('pop');
      }
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
      const co = document.getElementById('cart-overlay');
      const cs = document.getElementById('cart-sidebar');
      if (co) co.classList.add('active');
      if (cs) cs.classList.add('active');
    }
    function closeCart() {
      const co = document.getElementById('cart-overlay');
      const cs = document.getElementById('cart-sidebar');
      if (co) co.classList.remove('active');
      if (cs) cs.classList.remove('active');
    }

    document.querySelectorAll('#cart-icon, #cart-btn').forEach((btn) => {
      btn.addEventListener('click', openCart);
    });
    const cartCloseBtn = document.getElementById('cart-close');
    if (cartCloseBtn) cartCloseBtn.addEventListener('click', closeCart);
    const cartOverlayEl = document.getElementById('cart-overlay');
    if (cartOverlayEl) cartOverlayEl.addEventListener('click', closeCart);
    const continueBtn = document.getElementById('continue-browsing');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        closeCart();
        if (!document.getElementById('product-grid')) {
          window.location.href = 'products.html';
        }
      });
    }

    function renderCart() {
      const box = document.getElementById('cart-items');
      if (!box) return;
      box.innerHTML = cart.length ? cart.map((l, i) => {
        const p = byId(l.product_id);
        const name = p ? p.name : '#' + l.product_id;
        const line = p ? l.bundles * p.price_bundle_centavos : 0;
        const pieces = l.bundles * (p ? Number(p.pieces_per_bundle || 25) : 25);
        const available = Number(p && p.bundles_available || 0);
        return '<div class="cart-line' + (selectedProductIds.has(l.product_id) ? ' is-selected' : '') + '">' +
          '<label class="cart-line-select"><input type="checkbox" data-cselect="' + l.product_id + '"' +
          (selectedProductIds.has(l.product_id) ? ' checked' : '') + ' aria-label="Select ' + U.escapeHtml(name) + ' for checkout">' +
          '<span class="cart-line-product"><strong>' + U.escapeHtml(name) + '</strong><small>' +
          l.bundles + ' bundles · ' + pieces.toLocaleString() + ' pcs</small></span></label>' +
          '<div class="cart-quantity-wrap"><div class="quantity-options cart-quantity-options">' + quantityOptions.map((qty) =>
            '<label class="quantity-option' + (qty === l.bundles ? ' selected' : '') + (qty > available ? ' unavailable' : '') + '">' +
            '<input type="radio" name="cart-quantity-' + i + '" value="' + qty + '" data-cart-quantity="' + i + '"' +
            (qty === l.bundles ? ' checked' : '') + (qty > available ? ' disabled' : '') +
            ' aria-label="Choose ' + qty + ' Bundles of ' + U.escapeHtml(name) + '"><span>' + qty + '</span></label>'
          ).join('') + '</div><small>Available: ' + available.toLocaleString() + ' bundles</small>' +
          '<button type="button" data-cdel="' + i + '" aria-label="Remove ' + U.escapeHtml(name) + '">Remove</button></div>' +
          '<div><strong>' + U.pesos(line) + '</strong></div></div>';
      }).join('') : '<p class="empty-state">' + t('cart.empty') + '</p>';
      const selected = selectedLines();
      const { bundles, total } = totals(selected);
      document.querySelectorAll('#cart-count, .cart-badge').forEach((badge) => {
        badge.textContent = cart.length;
        badge.hidden = !cart.length;
        badge.setAttribute('aria-label', cart.length + ' product' + (cart.length === 1 ? '' : 's') + ' in cart');
      });
      const cTot = document.getElementById('cart-total');
      if (cTot) cTot.textContent = U.pesos(total);
      const cSel = document.getElementById('cart-selected-label');
      if (cSel) {
        cSel.textContent = selected.length + ' product' + (selected.length === 1 ? '' : 's') + ' selected · ' + bundles.toLocaleString() + ' bundles';
      }
      const checkout = document.getElementById('proceed-checkout');
      if (checkout) {
        checkout.disabled = selected.length === 0;
        checkout.innerHTML = '<i class="fas fa-credit-card"></i> Checkout selected (' + selected.length + ')';
      }
    }

    async function refreshCartCatalog() {
      const prodRes = await api.products();
      catalog = (prodRes.products || []).filter((p) => !p.is_archived);
      const availableIds = new Set(catalog.map((p) => Number(p.id)));
      cart = sanitize(cart);
      selectedProductIds = new Set([...selectedProductIds].filter((id) =>
        availableIds.has(Number(id)) && cart.some((line) => line.product_id === Number(id))));
      persist();
      renderGrid();
      renderCart();
    }

    function selectedLines() { return cart.filter((line) => selectedProductIds.has(line.product_id)); }

    const cartItemsEl = document.getElementById('cart-items');
    if (cartItemsEl) {
      cartItemsEl.addEventListener('click', (e) => {
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
        if (del) {
          removedProductId = cart[del.dataset.cdel].product_id;
          cart.splice(del.dataset.cdel, 1);
        }
        if (removedProductId !== null) selectedProductIds.delete(removedProductId);
        if (del) { persist(); renderCart(); }
      });
      cartItemsEl.addEventListener('change', (e) => {
        const quantity = e.target.closest('[data-cart-quantity]');
        if (!quantity) return;
        cart[Number(quantity.dataset.cartQuantity)].bundles = Number(quantity.value);
        persist();
        renderCart();
      });
      cartItemsEl.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.matches('[data-cart-quantity]')) return;
        e.preventDefault();
        e.target.checked = true;
        e.target.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

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
      const stepEl = document.getElementById(id);
      if (stepEl) stepEl.classList.add('active');
    }
    function openCheckout() {
      const coOverlay = document.getElementById('checkout-overlay');
      if (coOverlay) coOverlay.classList.add('active');
      api.settingsPublic().then((res) => {
        if (res && res.settings) {
          Object.assign(settings, res.settings);
          minBundles = Math.max(1, parseInt(settings.min_order_bundles, 10) || 300);
          setMethod(co.method || 'GCASH');
        }
      }).catch(() => {});
    }
    function closeCheckout() {
      const coOverlay = document.getElementById('checkout-overlay');
      if (coOverlay) coOverlay.classList.remove('active');
    }

    const proceedCheckoutBtn = document.getElementById('proceed-checkout');
    if (proceedCheckoutBtn) {
      proceedCheckoutBtn.addEventListener('click', () => {
        if (!selectedLines().length) { U.toast('Select at least one product to check out.'); return; }
        const { bundles } = totals(selectedLines());
        if (bundles < minBundles) {
          U.toast(t('co.below_min', { n: minBundles, have: bundles }));
          return;
        }
        isDirectSingleCheckout = false;
        closeCart();
        if (!document.getElementById('checkout-overlay')) {
          const ids = [...selectedProductIds].join(',');
          window.location.href = 'products.html?checkout=1' + (ids ? '&selected=' + ids : '');
          return;
        }
        startCheckout();
      });
    }

    function startCheckout() {
      co.items = selectedLines().map((line) => ({ ...line }));
      const { bundles } = totals(co.items);
      if (co.items.some((line) => !quantityOptions.includes(line.bundles))) {
        U.toast('Choose one of the available bundle quantities for every selected product.');
        openCart();
        return;
      }
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
      api.settingsPublic().then((res) => {
        if (res && res.settings) {
          Object.assign(settings, res.settings);
          setMethod(co.method || 'GCASH');
        }
      }).catch(() => {});
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

    const infoBackBtn = document.getElementById('info-back-btn');
    if (infoBackBtn) {
      infoBackBtn.addEventListener('click', () => {
        closeCheckout();
        if (!isDirectSingleCheckout) {
          openCart();
        }
      });
    }

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

    const custContact = document.getElementById('cust-contact');
    if (custContact) {
      custContact.maxLength = 11;
      custContact.addEventListener('input', () => {
        custContact.value = custContact.value.replace(/\D/g, '').slice(0, 11);
      });
    }

    const infoForm = document.getElementById('info-form');
    if (infoForm) {
      infoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        co.name = document.getElementById('cust-name').value.trim();
        co.contact = document.getElementById('cust-contact').value.replace(/\D/g, '').slice(0, 11).trim();
        co.email = document.getElementById('cust-email').value.trim().toLowerCase();
        co.address = document.getElementById('cust-address').value.trim();

        const proceedBtn = document.getElementById('info-proceed-btn');
        if (proceedBtn) {
          proceedBtn.disabled = true;
          proceedBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending code...';
        }

        try {
          ensureOtp().clear();
          const emailDisp = document.getElementById('checkout-otp-email-display');
          if (emailDisp) emailDisp.textContent = co.email;
          gotoStep('step-otp');
          await sendCheckoutOtp(false);
        } finally {
          if (proceedBtn) {
            proceedBtn.disabled = false;
            proceedBtn.innerHTML = '<i class="fas fa-arrow-right"></i> Proceed to Payment';
          }
        }
      });
    }

    const otpBackBtn = document.getElementById('otp-back-btn');
    if (otpBackBtn) otpBackBtn.addEventListener('click', () => gotoStep('step-info'));
    const otpVerifyBtn = document.getElementById('otp-verify-btn');
    if (otpVerifyBtn) {
      otpVerifyBtn.addEventListener('click', () => {
        verifyCheckoutOtp(ensureOtp().code());
      });
    }

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

    let isVerifyingOtp = false;

    async function verifyCheckoutOtp(code) {
      if (isVerifyingOtp) return;
      if (!code || code.length !== 6) { showOtpError(t('co.otp_bad')); return; }
      isVerifyingOtp = true;
      const verifyBtn = document.getElementById('otp-verify-btn');
      if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
      }
      try {
        await api.otpVerify(co.email, 'CHECKOUT', code);
        await createOrderThenPayment();
      } catch (err) {
        ensureOtp().clear();
        showOtpError(err.message);
      } finally {
        isVerifyingOtp = false;
        if (verifyBtn) {
          verifyBtn.disabled = false;
          verifyBtn.innerHTML = '<i class="fas fa-check-circle"></i> Verify';
        }
      }
    }

    /* ---------------- order create + payment ---------------- */

    /** Create the order, then reveal the payment step with SERVER amounts. */
    async function createOrderThenPayment() {
      gotoStep('step-stock'); // reuse the loader look while creating
      try {
        const body = {
          customer: { name: co.name, email: co.email, contact: co.contact, address: co.address },
          items: co.items.map((l) => ({ product_id: Number(l.product_id), bundles: Number(l.bundles) })),
          payment_method: co.method,
          idempotency_key: co.key,
        };
        const token = auth.token() || undefined;
        const { order } = await api.createOrder(body, token);
        co.order = order;
        try {
          const sRes = await api.settingsPublic();
          if (sRes && sRes.settings) Object.assign(settings, sRes.settings);
        } catch { /* use existing cached settings */ }
        renderReview();
        setMethod(co.method);
        gotoStep('step-payment');
      } catch (err) {
        if (err.code === 'PRODUCT_UNAVAILABLE') {
          try {
            await refreshCartCatalog();
            closeCheckout();
            openCart();
            U.toast(err.message || 'A product in your cart is no longer available. Your cart has been updated.');
            return;
          } catch { /* Preserve the original checkout error if refresh fails. */ }
        }
        gotoStep('step-otp');
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
        return '<div class="review-line"><span>' + U.escapeHtml(p ? p.name : '#' + l.product_id) +
          ' × ' + l.bundles + ' Bundles</span><span>' +
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
      const methInput = document.getElementById('payment-method');
      if (methInput) methInput.value = isGcash ? 'GCash' : 'PayMaya';
      const btnG = document.getElementById('btn-method-gcash');
      if (btnG) btnG.classList.toggle('active-gcash', isGcash);
      const btnM = document.getElementById('btn-method-maya');
      if (btnM) btnM.classList.toggle('active-maya', !isGcash);
      const brandLbl = document.getElementById('qr-brand-label');
      if (brandLbl) brandLbl.textContent = isGcash ? 'GCash' : 'Maya';
      const refLbl = document.getElementById('ref-field-label');
      if (refLbl) refLbl.textContent = isGcash ? 'GCash' : 'Maya';
      const qrNum = document.getElementById('qr-num-display');
      if (qrNum) qrNum.textContent = isGcash ? (settings.gcash_number || '-') : (settings.paymaya_number || '-');
      const qrName = document.getElementById('qr-name-display');
      if (qrName) qrName.textContent = settings.account_name || '-';
      const img = document.getElementById('payment-qr-img');
      if (img) {
        const src = qrSrc(method) || ('../../assets/qr-' + (isGcash ? 'gcash' : 'paymaya') + '-placeholder.png');
        img.style.display = '';
        img.src = src;
        img.onerror = function () {
          this.onerror = null;
          this.src = '../../assets/qr-' + (isGcash ? 'gcash' : 'paymaya') + '-placeholder.png';
        };
      }
      const ref = document.getElementById('gcash-ref');
      if (ref) {
        ref.value = '';
        ref.maxLength = isGcash ? 13 : 16;
        ref.placeholder = isGcash ? 'e.g. 1000123456789 (13 digits)' : 'e.g. 1000123456789012 (16 digits)';
      }
    }

    const btnGcash = document.getElementById('btn-method-gcash');
    if (btnGcash) btnGcash.addEventListener('click', () => setMethod('GCASH'));
    const btnMaya = document.getElementById('btn-method-maya');
    if (btnMaya) btnMaya.addEventListener('click', () => setMethod('MAYA'));
    const copyAccBtn = document.getElementById('copy-acc-btn');
    if (copyAccBtn) {
      copyAccBtn.addEventListener('click', async () => {
        const num = (document.getElementById('qr-num-display')?.textContent || '').replace(/\s/g, '');
        try {
          await navigator.clipboard.writeText(num);
          const copyTxt = document.getElementById('copy-btn-text');
          if (copyTxt) copyTxt.textContent = 'Copied';
          window.setTimeout(() => { if (copyTxt) copyTxt.textContent = 'Copy'; }, 1500);
        } catch { /* clipboard unavailable */ }
      });
    }
    const payBackBtn = document.getElementById('payment-back-btn');
    if (payBackBtn) payBackBtn.addEventListener('click', () => gotoStep('step-info'));

    function payError(msg) {
      const el = document.getElementById('payment-error-msg');
      if (!el) return;
      if (!msg) { el.style.display = 'none'; return; }
      el.textContent = msg;
      el.style.display = 'block';
    }

    const payBtn = document.getElementById('pay-btn');
    if (payBtn) {
      payBtn.addEventListener('click', async (e) => {
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
          if (!co.order) {
            await createOrderThenPayment();
            if (!co.order) return;
          }
          const form = new FormData();
          form.append('channel', co.method);
          form.append('reference_number', ref);
          form.append('email', co.email);
          form.append('proof', file);
          await api.submitPayment(co.order.order_code, form, auth.token() || undefined);
          showSuccess();
        } catch (err) {
          payError(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    }

    /* ---------------- success ---------------- */

    function showSuccess() {
      const o = co.order;
      document.getElementById('success-order-id-card').innerHTML =
        '<div class="success-id-card"><span>Order ID</span><strong>' + U.escapeHtml(o.order_code) +
        '</strong><a href="track.html?code=' + encodeURIComponent(o.order_code) +
        '">Check order status</a></div>';
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

    const orderAgainBtn = document.getElementById('order-again-btn');
    if (orderAgainBtn) {
      orderAgainBtn.addEventListener('click', () => {
        const ref = document.getElementById('gcash-ref');
        if (ref) ref.value = '';
        const proof = document.getElementById('gcash-proof');
        if (proof) proof.value = '';
        co.order = null;
        closeCheckout();
        init().catch(() => {});
      });
    }
    const successNavBtn = document.getElementById('success-nav-btn');
    if (successNavBtn) successNavBtn.addEventListener('click', closeCheckout);

    /* ---------------- customer reviews (dynamic from database) ---------------- */

    async function loadReviews() {
      const container = document.getElementById('reviews-container');
      if (!container) return;
      try {
        const { reviews: list } = await api.reviews();
        if (!list || !list.length) return;
        container.innerHTML = list.map((r) => {
          const stars = Array.from({ length: 5 }, (_, i) =>
            '<i class="' + (i < (r.rating || 5) ? 'fas' : 'far') + ' fa-star"></i>'
          ).join('');
          const nameParts = String(r.display_name || 'Customer').replace(/^Sample Review\s*-\s*/i, '').split(',');
          const name = nameParts[0].trim();
          const loc = nameParts[1] ? nameParts[1].trim() : 'Bulacan';
          const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'CR';
          const text = r.text_en || r.text || '';
          return '<div class="review-card">' +
            '<div class="review-stars">' + stars + '</div>' +
            '<p class="review-quote">"' + U.escapeHtml(text) + '"</p>' +
            '<div class="review-author">' +
            '<div class="review-avatar">' + U.escapeHtml(initials) + '</div>' +
            '<div class="review-author-info">' +
            '<h4>' + U.escapeHtml(name) + '</h4>' +
            '<small>' + U.escapeHtml(loc) + '</small>' +
            '</div></div></div>';
        }).join('');
      } catch { /* Preserve fallback static cards */ }
    }

    // Review Modal Open / Close / Rating / Submission
    const openRevBtn = document.getElementById('btn-open-review-modal');
    const revModal = document.getElementById('review-modal');
    const revOverlay = document.getElementById('review-overlay');
    const revClose = document.getElementById('review-close');
    const revCancel = document.getElementById('review-cancel');
    const revForm = document.getElementById('review-form');

    function openReviewModal() {
      if (revOverlay && revModal) {
        revOverlay.classList.add('active');
        revModal.classList.add('active');
      }
    }
    function closeReviewModal() {
      if (revOverlay && revModal) {
        revOverlay.classList.remove('active');
        revModal.classList.remove('active');
      }
    }

    function openReviewModalWith(opts) {
      if (!opts) return;
      const oIdEl = document.getElementById('rev-order-id');
      if (oIdEl) oIdEl.value = opts.order_id || '';
      const oCodeEl = document.getElementById('rev-order-code');
      if (oCodeEl) oCodeEl.value = opts.order_code || '';
      const pIdEl = document.getElementById('rev-product-id');
      if (pIdEl) pIdEl.value = opts.product_id || '';
      const pNameEl = document.getElementById('rev-product-name');
      if (pNameEl) pNameEl.value = opts.product_name || '';

      const selGrp = document.getElementById('rev-product-select-group');
      if (selGrp) selGrp.style.display = 'none';
      const pnGrp = document.getElementById('rev-product-name-group');
      if (pnGrp) pnGrp.style.display = opts.product_name ? 'block' : 'none';
      const ocGrp = document.getElementById('rev-order-code-group');
      if (ocGrp) ocGrp.style.display = opts.order_code ? 'block' : 'none';

      const textEl = document.getElementById('rev-text');
      if (textEl) textEl.value = '';
      if (starBox) {
        starBox.querySelectorAll('[data-star]').forEach((s) => { s.className = 'fas fa-star'; });
      }
      if (document.getElementById('rev-rating')) document.getElementById('rev-rating').value = '5';
      openReviewModal();
    }

    if (openRevBtn) {
      openRevBtn.addEventListener('click', async () => {
        if (!auth.token()) {
          U.toast('You can review this product after your order is completed. Please sign in to check your orders.');
          return;
        }
        try {
          const res = await api.reviewEligibility();
          if (!res.eligible || !res.available || !res.available.length) {
            U.toast(res.message || 'You can review this product after your order is completed.');
            return;
          }
          const selGroup = document.getElementById('rev-product-select-group');
          const sel = document.getElementById('rev-product-select');
          if (selGroup && sel) {
            sel.innerHTML = res.available.map((it, idx) =>
              '<option value="' + idx + '">' + U.escapeHtml(it.product_name) + ' (Order #' + U.escapeHtml(it.order_code) + ')</option>'
            ).join('');
            selGroup.style.display = res.available.length > 1 ? 'block' : 'none';
            const selectItem = (idx) => {
              const it = res.available[idx];
              if (!it) return;
              const oId = document.getElementById('rev-order-id');
              if (oId) oId.value = it.order_id;
              const pId = document.getElementById('rev-product-id');
              if (pId) pId.value = it.product_id;
              const pn = document.getElementById('rev-product-name');
              if (pn) pn.value = it.product_name;
              const oc = document.getElementById('rev-order-code');
              if (oc) oc.value = it.order_code;
            };
            sel.onchange = () => selectItem(Number(sel.value));
            selectItem(0);
          }
          openReviewModal();
        } catch (err) {
          U.toast(err.message || 'Could not verify eligibility.');
        }
      });
    }

    if (revClose) revClose.addEventListener('click', closeReviewModal);
    if (revCancel) revCancel.addEventListener('click', closeReviewModal);
    if (revOverlay) revOverlay.addEventListener('click', closeReviewModal);

    const starBox = document.getElementById('review-star-rating');
    if (starBox) {
      const starIcons = starBox.querySelectorAll('[data-star]');
      const ratingInput = document.getElementById('rev-rating');
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

    if (revForm) {
      revForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const orderId = document.getElementById('rev-order-id')?.value;
        const productId = document.getElementById('rev-product-id')?.value;
        const name = (document.getElementById('rev-name')?.value || '').trim();
        const location = (document.getElementById('rev-location')?.value || '').trim() || 'Bulacan';
        const rating = Number(document.getElementById('rev-rating')?.value) || 5;
        const text = (document.getElementById('rev-text')?.value || '').trim();

        if (!orderId || !productId) {
          U.toast('Please select an eligible completed order item to review.');
          return;
        }

        const submitBtn = document.getElementById('review-submit-btn');
        if (submitBtn) submitBtn.disabled = true;
        try {
          await api.reviewSubmit({
            order_id: Number(orderId),
            product_id: Number(productId),
            name, location, rating, text,
          });
          U.toast('Review submitted! Thank you for your feedback.');
          revForm.reset();
          if (starBox) {
            starBox.querySelectorAll('[data-star]').forEach((s) => { s.className = 'fas fa-star'; });
          }
          if (document.getElementById('rev-rating')) document.getElementById('rev-rating').value = '5';
          closeReviewModal();
          await loadReviews();
        } catch (err) {
          U.toast(err.message || 'Could not submit review.');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

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
      const grid = document.getElementById('product-grid');
      if (grid) grid.innerHTML = '<p class="error-text">' + U.escapeHtml(err.message) + '</p>';
    });
  });
})(window, document);
