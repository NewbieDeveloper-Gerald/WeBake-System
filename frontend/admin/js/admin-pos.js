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
      const { products: list } = await api.products();
      products = (list || []).filter((p) => !p.is_archived);
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
        '<div class="pos-product-add">' +
        '<button type="button" class="btn btn-primary btn-sm pos-add-bundle" data-add-bundle="' + p.id + '"' +
        (p.stock_pieces < p.pieces_per_bundle ? ' disabled' : '') + '><i class="fas fa-plus"></i> Bundle</button> ' +
        '<button type="button" class="btn btn-outline btn-sm pos-add-piece" data-add-piece="' + p.id + '"' +
        (p.stock_pieces < 1 ? ' disabled' : '') + '><i class="fas fa-plus"></i> Piece</button>' +
        '</div></div>'
      ).join('') || '<p class="muted">No products match.</p>';
    }

    document.getElementById('pos-product-grid').addEventListener('click', (e) => {
      const bd = e.target.closest('[data-add-bundle]');
      if (bd) addToCart(bd.dataset.addBundle, 'BUNDLE', 1);
      const pc = e.target.closest('[data-add-piece]');
      if (pc) addToCart(pc.dataset.addPiece, 'PIECE', 1);
    });

    function addToCart(id, unit, qty = 1) {
      const p = products.find((x) => String(x.id) === String(id));
      if (!p || p.stock_pieces <= 0) { window.alert('Out of stock.'); return; }
      const neededPieces = unit === 'BUNDLE' ? qty * p.pieces_per_bundle : qty;
      const found = cart.find((c) => c.product_id === p.id && c.unit === unit);
      const currentPieces = found ? (found.unit === 'BUNDLE' ? found.qty * p.pieces_per_bundle : found.qty) : 0;
      if (p.stock_pieces < currentPieces + neededPieces) {
        window.alert('Insufficient stock of ' + p.name + '.');
        return;
      }
      if (found) found.qty += qty;
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
        '<div class="pos-cart-line-controls"><div class="pos-qty-ctrl">' +
        '<button type="button" class="btn btn-outline btn-sm pos-qty-button" data-dec="' + i + '" aria-label="Decrease quantity">−</button>' +
        '<span>' + c.qty + '</span>' +
        '<button type="button" class="btn btn-outline btn-sm pos-qty-button" data-inc="' + i + '" aria-label="Increase quantity">+</button></div>' +
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
      if (inc) {
        const c = cart[inc.dataset.inc];
        const p = products.find((x) => x.id === c.product_id);
        const pieces = c.unit === 'BUNDLE' ? (c.qty + 1) * p.pieces_per_bundle : c.qty + 1;
        if (p && p.stock_pieces < pieces) {
          window.alert('Cannot add more. Insufficient stock.');
          return;
        }
        c.qty += 1;
      }
      if (dec) {
        const c = cart[dec.dataset.dec];
        c.qty -= 1;
        if (c.qty <= 0) cart.splice(dec.dataset.dec, 1);
      }
      if (del) cart.splice(del.dataset.del, 1);
      if (inc || dec || del) renderCart();
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
