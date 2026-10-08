/**
 * admin-pos: walk-in counter sales (legacy shell).
 *
 * WHAT: Product grid (bundle/piece pricing), cart slip, cash tendering with
 * change math, one-shot sale recording, and a printable thermal receipt.
 *
 * SPEC RULES (hidden legacy elements, not deleted): counter sales are paid in
 * full in CASH - so the downpayment switch, advance reservation, customer
 * linking, and e-wallet tabs are hidden. Stock deducts from the same counter
 * as online orders at the moment of sale.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('pos-product-grid')) return; // not this page

    const ui = window.AdminUI;
    const api = window.AdminAPI;
    let products = [];
    let quantityOptions = [];
    let cart = []; // {product_id, name, unit, qty, unit_price, ppb}

    // --- hide non-spec POS features ---
    (function adaptShell() {
      const hide = (sel) => document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
      hide('.pos-type-toggle-btn[data-type="advance"]');
      hide('#pos-advance-details');
      hide('.pos-customer-box');
      hide('.pos-downpayment-switch-row');
      hide('#pos-downpayment-row');
      hide('#pos-balance-row');
      hide('.pos-pay-tab-btn[data-method="GCash"]');
      hide('.pos-pay-tab-btn[data-method="PayMaya"]');
      hide('#pos-ewallet-box');
    })();

    document.getElementById('pos-search').addEventListener('input', renderGrid);

    async function load() {
      const [{ products: list }, settingsRes] = await Promise.all([api.products(), api.settingsPublic()]);
      products = (list || []).filter((p) => !p.is_archived);
      quantityOptions = (settingsRes.settings.order_quantity_options || []).map(Number).filter(Number.isInteger);
      renderGrid();
      renderCart();
    }

    function renderGrid() {
      const q = document.getElementById('pos-search').value.trim().toLowerCase();
      const list = products.filter((p) => !q || p.name.toLowerCase().includes(q));
      document.getElementById('pos-product-grid').innerHTML = list.map((p) =>
        '<div class="pos-product-card' + (p.stock_pieces <= 0 ? ' out' : '') + '">' +
        '<div class="pos-product-name">' + ui.esc(p.name) + '</div>' +
        '<div class="pos-product-prices">' + ui.pesos(p.price_bundle_centavos) + ' / bundle<br>' +
        ui.pesos(p.piece_price_centavos) + ' / piece</div>' +
        '<div class="pos-product-stock">' + p.stock_pieces + ' pcs · ' + Number(p.bundles_available || 0) + ' bundles available</div>' +
        '<div class="pos-product-add pos-bundle-picker"><div class="pos-quantity-options" role="radiogroup" aria-label="Bundle quantity for ' + ui.esc(p.name) + '">' +
        quantityOptions.map((qty) => '<label class="pos-quantity-option' + (qty > Number(p.bundles_available || 0) ? ' unavailable' : '') + '">' +
          '<input type="radio" name="pos-bundle-' + p.id + '" value="' + qty + '" data-pos-quantity="' + p.id + '"' +
          (qty > Number(p.bundles_available || 0) ? ' disabled' : '') + ' aria-label="' + qty + ' Bundles of ' + ui.esc(p.name) + '"><span>' + qty + ' Bundles</span></label>').join('') +
        '</div><small class="pos-quantity-total" id="pos-quantity-total-' + p.id + '">Select a quantity for total price</small>' +
        '<button type="button" class="btn btn-primary btn-sm pos-add-bundle" data-add-bundle="' + p.id + '" disabled>Add bundles</button> ' +
        '<button type="button" class="btn btn-outline btn-sm pos-add-piece" data-add-piece="' + p.id + '"><i class="fas fa-plus"></i> Piece</button>' +
        '</div></div>'
      ).join('') || '<p class="muted">No products match.</p>';
    }

    document.getElementById('pos-product-grid').addEventListener('click', (e) => {
      const pc = e.target.closest('[data-add-piece]');
      if (pc) addToCart(pc.dataset.addPiece, 'PIECE');
    });

    document.getElementById('pos-product-grid').addEventListener('change', (e) => {
      const radio = e.target.closest('[data-pos-quantity]');
      if (!radio) return;
      const add = document.querySelector('[data-add-bundle="' + radio.dataset.posQuantity + '"]');
      add.disabled = false;
      const product = products.find((p) => String(p.id) === String(radio.dataset.posQuantity));
      document.getElementById('pos-quantity-total-' + radio.dataset.posQuantity).textContent =
        'Total: ' + ui.pesos(Number(radio.value) * Number(product.price_bundle_centavos)) +
        ' · Available: ' + Number(product.bundles_available || 0) + ' bundles';
    });
    document.getElementById('pos-product-grid').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('[data-pos-quantity]')) return;
      e.preventDefault();
      e.target.checked = true;
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.getElementById('pos-product-grid').addEventListener('click', (e) => {
      const add = e.target.closest('[data-add-bundle]');
      if (!add) return;
      const selected = document.querySelector('input[name="pos-bundle-' + add.dataset.addBundle + '"]:checked');
      if (!selected) { window.alert('Please select a bundle quantity.'); return; }
      addToCart(add.dataset.addBundle, 'BUNDLE', Number(selected.value));
    });

    function addToCart(id, unit, qty = 1) {
      const p = products.find((x) => String(x.id) === String(id));
      if (!p || p.stock_pieces <= 0) { window.alert('Out of stock.'); return; }
      const found = cart.find((c) => c.product_id === p.id && c.unit === unit);
      if (found) found.qty = unit === 'BUNDLE' ? qty : found.qty + 1;
      else cart.push({
        product_id: p.id, name: p.name, unit, qty, ppb: p.pieces_per_bundle,
        unit_price: unit === 'BUNDLE' ? p.price_bundle_centavos : p.piece_price_centavos,
      });
      renderCart();
    }

    function cartTotal() {
      return cart.reduce((sum, c) => sum + c.unit_price * c.qty, 0);
    }

    function renderCart() {
      const box = document.getElementById('pos-cart-items-list');
      box.innerHTML = cart.length ? cart.map((c, i) =>
        '<div class="pos-cart-line"><div class="pos-cart-line-info"><strong>' + ui.esc(c.name) + '</strong><br>' +
        '<small class="muted">' + ui.pesos(c.unit_price) + ' / ' + c.unit.toLowerCase() +
        (c.unit === 'BUNDLE' ? ' · ' + c.ppb + ' pcs' : '') + '</small></div>' +
        '<div class="pos-cart-line-controls">' + (c.unit === 'BUNDLE' ? '<div class="pos-quantity-options">' + quantityOptions.map((qty) => {
          const product = products.find((p) => p.id === c.product_id);
          const available = Number(product && product.bundles_available || 0);
          return '<label class="pos-quantity-option' + (qty === c.qty ? ' selected' : '') + (qty > available ? ' unavailable' : '') + '">' +
            '<input type="radio" name="pos-cart-bundle-' + i + '" value="' + qty + '" data-cart-bundle="' + i + '"' +
            (qty === c.qty ? ' checked' : '') + (qty > available ? ' disabled' : '') + ' aria-label="Choose ' + qty + ' Bundles"><span>' + qty + '</span></label>';
        }).join('') + '</div>' : '<div class="pos-qty-ctrl">' +
        '<button type="button" class="btn btn-outline btn-sm pos-qty-button" data-dec="' + i + '" aria-label="Decrease piece quantity">−</button>' +
        '<span>' + c.qty + '</span>' +
        '<button type="button" class="btn btn-outline btn-sm pos-qty-button" data-inc="' + i + '" aria-label="Increase piece quantity">+</button></div>') +
        '<button type="button" class="btn btn-danger-outline btn-sm pos-remove-line" data-del="' + i + '" aria-label="Remove item">×</button></div>' +
        '<div><strong>' + ui.pesos(c.unit_price * c.qty) + '</strong></div></div>'
      ).join('') : '<div class="pos-slip-empty"><span><i class="fas fa-basket-shopping"></i></span><strong>Your order slip is empty</strong><small>Choose a product to start this walk-in sale.</small></div>';
      const itemCount = cart.reduce((sum, line) => sum + line.qty, 0);
      const countEl = document.getElementById('pos-slip-count');
      countEl.textContent = itemCount + ' item' + (itemCount === 1 ? '' : 's');
      countEl.classList.toggle('is-empty', itemCount === 0);
      const total = cartTotal();
      document.getElementById('pos-cart-subtotal').textContent = ui.pesos(total);
      document.getElementById('pos-total-due').textContent = ui.pesos(total);
      updateChange();
    }

    document.getElementById('pos-cart-items-list').addEventListener('click', (e) => {
      const inc = e.target.closest('[data-inc]');
      const dec = e.target.closest('[data-dec]');
      const del = e.target.closest('[data-del]');
      if (inc) cart[inc.dataset.inc].qty += 1;
      if (dec) {
        const c = cart[dec.dataset.dec];
        c.qty -= 1;
        if (c.qty <= 0) cart.splice(dec.dataset.dec, 1);
      }
      if (del) cart.splice(del.dataset.del, 1);
      if (inc || dec || del) renderCart();
    });
    document.getElementById('pos-cart-items-list').addEventListener('change', (e) => {
      const bundleQty = e.target.closest('[data-cart-bundle]');
      if (!bundleQty) return;
      cart[Number(bundleQty.dataset.cartBundle)].qty = Number(bundleQty.value);
      renderCart();
    });
    document.getElementById('pos-cart-items-list').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('[data-cart-bundle]')) return;
      e.preventDefault();
      e.target.checked = true;
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
    });

    document.getElementById('btn-clear-cart').addEventListener('click', () => {
      cart = [];
      document.getElementById('pos-cash-tendered').value = '';
      renderCart();
    });

    // --- cash tendering ---
    function updateChange() {
      const tendered = Math.round(Number(document.getElementById('pos-cash-tendered').value || 0) * 100);
      const change = tendered - cartTotal();
      document.getElementById('pos-change-amount').textContent =
        ui.pesos(change > 0 ? change : 0);
      return { tendered, change };
    }

    document.getElementById('pos-cash-tendered').addEventListener('input', updateChange);
    document.querySelectorAll('.cash-chip-btn').forEach((chip) => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('pos-cash-tendered');
        input.value = chip.dataset.amount === 'exact'
          ? (cartTotal() / 100).toFixed(2)
          : chip.dataset.amount;
        updateChange();
      });
    });

    // --- complete sale -> receipt modal ---
    document.getElementById('btn-pos-complete').addEventListener('click', async (e) => {
      if (!cart.length) { window.alert('The slip is empty.'); return; }
      const { tendered, change } = updateChange();
      if (change < 0) { window.alert('Cash is short by ' + ui.pesos(-change) + '.'); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { receipt: r } = await api.posSale({
          items: cart.map((c) => ({ product_id: c.product_id, unit: c.unit, qty: c.qty })),
          cash_received_centavos: tendered,
        });
        showReceipt(r);
        cart = [];
        document.getElementById('pos-cash-tendered').value = '';
        renderCart();
        await refreshStock();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    function showReceipt(r) {
      const lines = r.lines.map((l) =>
        '<div class="rcpt-line"><span>' + ui.esc(l.product_name) + ' x' + l.qty + ' ' +
        l.unit.toLowerCase() + '</span><span>' + ui.pesos(l.line_total_centavos) + '</span></div>'
      ).join('');
      document.getElementById('receipt-print-area').innerHTML =
        '<div class="rcpt"><div class="rcpt-head"><strong>WeBake - Crumbs N\' Rolls Bakery</strong><br>' +
        'Walk-in Receipt ' + ui.esc(r.sale_code) + '<br>' + ui.fmtDate(r.created_at) + '</div>' +
        lines + '<div class="rcpt-total"><span>TOTAL</span><span>' + ui.pesos(r.total_centavos) +
        '</span></div><div class="rcpt-line"><span>Cash</span><span>' +
        ui.pesos(r.cash_received_centavos) + '</span></div>' +
        '<div class="rcpt-line"><span>Change</span><span>' + ui.pesos(r.change_centavos) +
        '</span></div><div class="rcpt-head">Thank you, come again.</div></div>';
      document.getElementById('pos-receipt-modal').classList.add('active');
    }

    document.getElementById('btn-close-receipt').addEventListener('click', () => {
      document.getElementById('pos-receipt-modal').classList.remove('active');
    });
    document.getElementById('btn-print-receipt').addEventListener('click', () => window.print());

    async function refreshStock() {
      const { products: list } = await api.products();
      products = (list || []).filter((p) => !p.is_archived);
      renderGrid();
    }

    load().catch((err) => {
      document.getElementById('pos-product-grid').innerHTML =
        '<p class="error-text">' + ui.esc(err.message) + '</p>';
    });
  });
})();
