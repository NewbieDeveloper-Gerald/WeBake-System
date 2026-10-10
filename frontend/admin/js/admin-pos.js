/**
 * admin-pos: walk-in counter sales with upgraded Order Slip & stock filters.
 *
 * WHAT: Product grid (bundle/piece pricing), available-only filtering,
 * interactive order slip with live change math, single-shot sale recording,
 * and thermal receipt printing.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('pos-product-grid')) return; // not this page

    const ui = window.AdminUI;
    const api = window.AdminAPI;
    let products = [];
    let cart = []; // {product_id, name, unit, qty, unit_price, ppb}
    let currentFilter = 'all';

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

    // Search input listener
    const searchInput = document.getElementById('pos-search');
    if (searchInput) searchInput.addEventListener('input', renderGrid);

    // "All Products" vs "Available Only" filter pills
    document.querySelectorAll('.pos-category-filters .pos-filter-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.pos-category-filters .pos-filter-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentFilter = pill.dataset.category || 'all';
        renderGrid();
      });
    });

    async function load() {
      const { products: list } = await api.products();
      products = (list || []).filter((p) => !p.is_archived);
      renderGrid();
      renderCart();
    }

    function renderGrid() {
      const q = (searchInput ? searchInput.value.trim().toLowerCase() : '');
      let list = products;

      // Filter by stock availability
      if (currentFilter === 'in_stock') {
        list = list.filter((p) => p.stock_pieces > 0);
      }

      // Filter by text search
      if (q) {
        list = list.filter((p) => p.name.toLowerCase().includes(q));
      }

      const grid = document.getElementById('pos-product-grid');
      if (!list.length) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--text-muted);"><i class="fas fa-boxes" style="font-size:2rem;margin-bottom:0.5rem;display:block;"></i>No products match the selected filter.</div>';
        return;
      }

      grid.innerHTML = list.map((p) => {
        const isOutOfStock = p.stock_pieces <= 0;
        const bundlesAvailable = Number(p.bundles_available || 0);

        return '<div class="pos-product-card' + (isOutOfStock ? ' out' : '') + '">' +
          '<div class="pos-product-name">' + ui.esc(p.name) + '</div>' +
          '<div class="pos-product-prices">' +
          '<strong>' + ui.pesos(p.price_bundle_centavos) + '</strong> / bundle (' + p.pieces_per_bundle + ' pcs)<br>' +
          '<span>' + ui.pesos(p.piece_price_centavos) + '</span> / piece</div>' +
          '<div class="pos-product-stock' + (isOutOfStock ? ' text-danger font-bold' : '') + '">' +
          (isOutOfStock
            ? '<i class="fas fa-ban"></i> Out of Stock'
            : p.stock_pieces + ' pcs &bull; ' + bundlesAvailable + ' bundles ready') +
          '</div>' +
          '<div class="pos-product-add">' +
          '<button type="button" class="btn btn-primary btn-sm pos-add-bundle" data-add-bundle="' + p.id + '"' +
          (p.stock_pieces < p.pieces_per_bundle ? ' disabled' : '') + '><i class="fas fa-plus"></i> Bundle</button> ' +
          '<button type="button" class="btn btn-outline btn-sm pos-add-piece" data-add-piece="' + p.id + '"' +
          (p.stock_pieces < 1 ? ' disabled' : '') + '><i class="fas fa-plus"></i> Piece</button>' +
          '</div></div>';
      }).join('');
    }

    document.getElementById('pos-product-grid').addEventListener('click', (e) => {
      const bd = e.target.closest('[data-add-bundle]');
      if (bd) addToCart(bd.dataset.addBundle, 'BUNDLE', 1);
      const pc = e.target.closest('[data-add-piece]');
      if (pc) addToCart(pc.dataset.addPiece, 'PIECE', 1);
    });

    function addToCart(id, unit, qty = 1) {
      const p = products.find((x) => String(x.id) === String(id));
      if (!p || p.stock_pieces <= 0) {
        ui.toast('Product is out of stock.', 'danger');
        return;
      }
      const neededPieces = unit === 'BUNDLE' ? qty * p.pieces_per_bundle : qty;
      const found = cart.find((c) => c.product_id === p.id && c.unit === unit);
      const currentPieces = found ? (found.unit === 'BUNDLE' ? found.qty * p.pieces_per_bundle : found.qty) : 0;
      if (p.stock_pieces < currentPieces + neededPieces) {
        ui.toast('Insufficient stock of ' + p.name + ' (only ' + p.stock_pieces + ' pcs available).', 'danger');
        return;
      }
      if (found) {
        found.qty += qty;
      } else {
        cart.push({
          product_id: p.id,
          name: p.name,
          unit,
          qty,
          ppb: p.pieces_per_bundle,
          unit_price: unit === 'BUNDLE' ? p.price_bundle_centavos : p.piece_price_centavos,
        });
      }
      ui.toast('Added ' + p.name + ' (' + unit.toLowerCase() + ') to slip.', 'success');
      renderCart();
    }

    function cartTotal() {
      return cart.reduce((sum, c) => sum + c.unit_price * c.qty, 0);
    }

    function renderCart() {
      const box = document.getElementById('pos-cart-items-list');
      if (!cart.length) {
        box.innerHTML =
          '<div class="pos-slip-empty">' +
          '<span><i class="fas fa-basket-shopping"></i></span>' +
          '<strong>Your order slip is empty</strong>' +
          '<small>Choose bundles or single pieces on the left to start this walk-in sale.</small>' +
          '</div>';
      } else {
        box.innerHTML = cart.map((c, i) => {
          const unitTag = c.unit === 'BUNDLE'
            ? '<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#F8EEE5;color:#704638;font-size:0.68rem;font-weight:700;">Bundle (' + c.ppb + ' pcs)</span>'
            : '<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#EAF7ED;color:#28A745;font-size:0.68rem;font-weight:700;">Piece</span>';

          return '<div class="pos-cart-line" style="border-radius:12px;padding:0.75rem 0.85rem;background:#FFFEFC;border:1px solid #EDE4DC;box-shadow:0 2px 6px rgba(62,38,28,0.03);">' +
            '<div class="pos-cart-line-info" style="min-width:0;">' +
            '<div style="font-weight:700;color:#542D24;font-size:0.83rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + ui.esc(c.name) + '</div>' +
            '<div style="display:flex;align-items:center;gap:0.4rem;margin-top:0.25rem;">' +
            unitTag +
            '<span class="muted" style="font-size:0.72rem;">' + ui.pesos(c.unit_price) + ' each</span>' +
            '</div></div>' +
            '<div class="pos-cart-line-controls">' +
            '<div class="pos-qty-ctrl">' +
            '<button type="button" class="btn btn-outline btn-sm pos-qty-button" data-dec="' + i + '" aria-label="Decrease quantity" style="border-radius:8px;font-weight:700;">&minus;</button>' +
            '<span style="min-width:1.5rem;text-align:center;font-weight:800;font-size:0.82rem;color:#4D332A;">' + c.qty + '</span>' +
            '<button type="button" class="btn btn-outline btn-sm pos-qty-button" data-inc="' + i + '" aria-label="Increase quantity" style="border-radius:8px;font-weight:700;">&plus;</button>' +
            '</div>' +
            '<button type="button" class="btn btn-danger-outline btn-sm pos-remove-line" data-del="' + i + '" title="Remove item" style="border-radius:8px;"><i class="fas fa-trash-alt"></i></button>' +
            '</div>' +
            '<div style="text-align:right;"><strong style="font-size:0.88rem;color:#4B2B23;">' + ui.pesos(c.unit_price * c.qty) + '</strong></div>' +
            '</div>';
        }).join('');
      }

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
          ui.toast('Cannot add more. Insufficient stock of ' + p.name, 'danger');
          return;
        }
        c.qty += 1;
      }
      if (dec) {
        const c = cart[dec.dataset.dec];
        c.qty -= 1;
        if (c.qty <= 0) cart.splice(dec.dataset.dec, 1);
      }
      if (del) {
        cart.splice(del.dataset.del, 1);
      }
      if (inc || dec || del) renderCart();
    });

    document.getElementById('btn-clear-cart').addEventListener('click', () => {
      if (!cart.length) return;
      cart = [];
      document.getElementById('pos-cash-tendered').value = '';
      ui.toast('Order slip cleared.', 'info');
      renderCart();
    });

    // --- cash tendering ---
    function updateChange() {
      const inputVal = document.getElementById('pos-cash-tendered').value;
      const tendered = Math.round(Number(inputVal || 0) * 100);
      const total = cartTotal();
      const change = tendered - total;
      const changeEl = document.getElementById('pos-change-amount');

      if (!inputVal || Number(inputVal) === 0) {
        changeEl.textContent = ui.pesos(0);
        changeEl.style.color = '';
      } else if (change < 0) {
        changeEl.textContent = 'Short by ' + ui.pesos(-change);
        changeEl.style.color = 'var(--danger)';
      } else {
        changeEl.textContent = ui.pesos(change);
        changeEl.style.color = 'var(--success)';
      }
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
      if (!cart.length) {
        ui.toast('Your order slip is empty. Add products to proceed.', 'danger');
        return;
      }
      const { tendered, change } = updateChange();
      if (change < 0) {
        ui.alert('Cash tendered is short by ' + ui.pesos(-change) + '. Please collect full payment.', 'Insufficient Cash');
        return;
      }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { receipt: r } = await api.posSale({
          items: cart.map((c) => ({ product_id: Number(c.product_id), unit: c.unit, qty: Number(c.qty) })),
          cash_received_centavos: tendered,
        });
        showReceipt(r);
        cart = [];
        document.getElementById('pos-cash-tendered').value = '';
        renderCart();
        await refreshStock();
        ui.toast('Counter sale recorded successfully!', 'success');
      } catch (err) {
        ui.alert(err.message, 'Sale Processing Failed');
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
        '</span></div><div class="rcpt-head">Thank you, please come again!</div></div>';
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
