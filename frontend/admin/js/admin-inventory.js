/**
 * admin-inventory: stock table + manual adjustments + movement history.
 *
 * WHAT: One table of truthful stock (pieces + bundle equivalents + automatic
 * status), a manual adjustment card, and the append-only movement audit log.
 *
 * LEGACY ADAPTATIONS: the shell's batch/spoilage loggers assumed a different
 * backend (morning production, carried-over, spoilage columns). The rebuilt
 * backend tracks ONE stock counter per product with movement reasons, so the
 * old logger cards are hidden and the table/history are rebuilt to match.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('inventory-table-body')) return; // not this page

    const ui = window.AdminUI;
    const api = window.AdminAPI;
    let products = [];

    // Hide the legacy batch/spoilage logger row (different backend model).
    const loggerRow = document.getElementById('form-log-batch').closest('.form-row-2');
    if (loggerRow) loggerRow.style.display = 'none';

    // Inject the adjustment card where the loggers were.
    const adjustCard = document.createElement('div');
    adjustCard.className = 'admin-card';
    adjustCard.innerHTML =
      '<div class="card-header"><div class="card-title-group">' +
      '<h3><i class="fas fa-sliders-h"></i> Manual Stock Adjustment</h3>' +
      '<p>Add a delivery (RESTOCK) or correct the count (ADJUSTMENT). Every change is logged.</p>' +
      '</div></div><div class="card-body"><form id="form-adjust-stock">' +
      '<div class="form-row-2">' +
      '<div class="form-group"><label class="form-label">Product</label>' +
      '<select id="adjust-product" class="form-select"></select></div>' +
      '<div class="form-group"><label class="form-label">Mode</label>' +
      '<select id="adjust-mode" class="form-select">' +
      '<option value="change">Add / remove pieces</option>' +
      '<option value="set">Set exact count</option></select></div></div>' +
      '<div class="form-row-2">' +
      '<div class="form-group"><label class="form-label">Pieces (negative removes)</label>' +
      '<input type="number" id="adjust-qty" class="form-input" value="0"></div>' +
      '<div class="form-group"><label class="form-label">Reason</label>' +
      '<select id="adjust-reason" class="form-select">' +
      '<option value="RESTOCK">RESTOCK - new delivery / baked batch</option>' +
      '<option value="ADJUSTMENT">ADJUSTMENT - recount / correction</option></select></div></div>' +
      '<div class="form-group"><label class="form-label">Note</label>' +
      '<input type="text" id="adjust-note" class="form-input" maxlength="300" placeholder="e.g. Morning delivery from commissary"></div>' +
      '<button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Apply Adjustment</button>' +
      '</form></div>';
    loggerRow.parentNode.insertBefore(adjustCard, loggerRow.nextSibling);

    document.getElementById('form-adjust-stock').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('adjust-product').value;
      const mode = document.getElementById('adjust-mode').value;
      const qty = Number(document.getElementById('adjust-qty').value);
      const payload = {
        reason: document.getElementById('adjust-reason').value,
        note: document.getElementById('adjust-note').value.trim(),
      };
      // Exactly one of set/change (the API rejects both or neither).
      if (mode === 'set') payload.set_pieces = qty; else payload.change_pieces = qty;
      try {
        await api.adjustStock(id, payload);
        window.alert('Stock updated and logged.');
        document.getElementById('adjust-qty').value = 0;
        document.getElementById('adjust-note').value = '';
        await refresh();
      } catch (err) {
        window.alert(err.message);
      }
    });

    async function refresh() {
      const { products: list } = await api.products();
      products = (list || []).filter((p) => !p.is_archived);
      // Table header rebuilt to the real stock model.
      const table = document.getElementById('inventory-table-body').closest('table');
      table.querySelector('thead').innerHTML =
        '<tr><th>Product</th><th>Bundle</th><th>Stock</th><th>Status</th><th>Actions</th></tr>';
      document.getElementById('inventory-table-body').innerHTML = products.map((p) =>
        '<tr><td><strong>' + ui.esc(p.name) + '</strong></td><td>' +
        p.pieces_per_bundle + ' pcs / ' + ui.pesos(p.price_bundle_centavos) + '</td><td>' +
        p.stock_pieces + ' pcs (' + p.bundles_available + ' bdl)</td><td>' +
        ui.pill(p.stock_status) + '</td>' +
        '<td class="actions-cell"><button type="button" class="btn btn-outline btn-sm" data-history="' +
        p.id + '">History</button></td></tr>'
      ).join('');
      document.getElementById('adjust-product').innerHTML = products.map((p) =>
        '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + p.stock_pieces + ' pcs)</option>'
      ).join('');
      await loadHistory(null);
    }

    async function loadHistory(productId) {
      const { movements } = await api.movements(productId, 100);
      document.getElementById('inventory-history-tbody').innerHTML = (movements || []).length
        ? movements.map((m) =>
          '<tr><td>' + ui.fmtDate(m.created_at) + '</td><td>' + ui.esc(m.reason || '-') +
          '</td><td>' + ui.esc(m.product_name || ('#' + m.product_id)) + '</td><td>' +
          (m.change_pieces > 0 ? '+' : '') + m.change_pieces + ' pcs</td><td>' +
          ui.esc(m.note || '-') + '</td></tr>').join('')
        : '<tr><td colspan="5" class="muted">No movements yet.</td></tr>';
    }

    document.getElementById('inventory-table-body').addEventListener('click', async (e) => {
      const h = e.target.closest('[data-history]');
      if (!h) return;
      try {
        await loadHistory(h.dataset.history);
        document.getElementById('inventory-history-tbody').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (err) {
        window.alert(err.message);
      }
    });

    refresh().catch((err) => {
      document.getElementById('inventory-table-body').innerHTML =
        '<tr><td colspan="5" class="error-text">' + ui.esc(err.message) + '</td></tr>';
    });
  });
})();
