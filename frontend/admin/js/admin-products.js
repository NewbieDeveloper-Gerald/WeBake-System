/**
 * admin-products: catalog table + add/edit modal + archive/restore.
 *
 * WHAT: Lists products (archived included, greyed), saves through the admin
 * product endpoints, and converts the owner's peso inputs to centavos before
 * sending (the API only speaks integer centavos).
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('products-tbody')) return; // not this page

    const ui = window.AdminUI;
    const api = window.AdminAPI;
    let editingId = null;

    const modal = () => document.getElementById('modal-product');
    const open = () => modal().classList.add('active');
    const close = () => modal().classList.remove('active');

    /** Pesos string -> integer centavos (rounded, never float-stored). */
    function toCentavos(pesos) {
      return Math.round(Number(pesos) * 100);
    }

    async function load() {
      const tbody = document.getElementById('products-tbody');
      try {
        const { products } = await api.products(true);
        tbody.innerHTML = products.length ? products.map((p) =>
          '<tr' + (p.is_archived ? ' style="opacity:0.55;"' : '') + '><td><strong>' +
          ui.esc(p.name) + '</strong>' + (p.is_archived ? ' (archived)' : '') + '</td><td>' +
          ui.pesos(p.price_bundle_centavos) + '</td><td>' + p.pieces_per_bundle + '</td><td>' +
          ui.pesos(p.piece_price_centavos) + '</td><td>' + p.stock_pieces + ' pcs</td><td>' +
          ui.pill(p.is_archived ? 'ARCHIVED' : p.stock_status) + '</td><td class="actions-cell">' +
          '<button type="button" class="btn btn-outline btn-sm" data-edit="' + p.id + '">Edit</button> ' +
          (p.is_archived
            ? '<button type="button" class="btn btn-outline btn-sm" data-restore="' + p.id + '">Restore</button>'
            : '<button type="button" class="btn btn-outline btn-sm" data-archive="' + p.id + '">Archive</button>') +
          '</td></tr>'
        ).join('') : '<tr><td colspan="7" class="muted">No products yet.</td></tr>';
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" class="error-text">' + ui.esc(err.message) + '</td></tr>';
      }
    }

    function openForCreate() {
      editingId = null;
      document.getElementById('product-modal-title').textContent = 'Add Product';
      document.getElementById('product-form').reset();
      document.getElementById('prod-pieces').value = 25;
      document.getElementById('prod-threshold').value = 500;
      document.getElementById('prod-stock-wrap').style.display = '';
      open();
    }

    async function openForEdit(id) {
      // The list response already carries every field; find the row locally.
      const { products } = await api.products(true);
      const p = products.find((x) => String(x.id) === String(id));
      if (!p) return;
      editingId = p.id;
      document.getElementById('product-modal-title').textContent = 'Edit: ' + p.name;
      document.getElementById('prod-name').value = p.name;
      document.getElementById('prod-desc').value = p.description || '';
      document.getElementById('prod-price').value = (p.price_bundle_centavos / 100).toFixed(2);
      document.getElementById('prod-pieces').value = p.pieces_per_bundle;
      document.getElementById('prod-piece-price').value = (p.piece_price_centavos / 100).toFixed(2);
      document.getElementById('prod-threshold').value = p.low_stock_threshold_pieces;
      document.getElementById('prod-image').value = p.image_url || '';
      // Stock adjusts on the Inventory page, never by editing the product.
      document.getElementById('prod-stock-wrap').style.display = 'none';
      open();
    }

    document.getElementById('products-tbody').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      const arch = e.target.closest('[data-archive]');
      const rest = e.target.closest('[data-restore]');
      try {
        if (edit) { await openForEdit(edit.dataset.edit); return; }
        if (arch && ui.confirmAsk('Archive this product? It leaves the shop and POS, but order history stays.')) {
          await api.productArchive(arch.dataset.archive);
          await load();
        }
        if (rest) {
          await api.productRestore(rest.dataset.restore);
          await load();
        }
      } catch (err) {
        window.alert(err.message);
      }
    });

    document.getElementById('btn-add-product').addEventListener('click', openForCreate);
    document.getElementById('btn-close-product').addEventListener('click', close);
    modal().addEventListener('click', (e) => { if (e.target === modal()) close(); });

    document.getElementById('product-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-product');
      btn.disabled = true;
      try {
        const payload = {
          name: document.getElementById('prod-name').value.trim(),
          description: document.getElementById('prod-desc').value.trim(),
          price_bundle_centavos: toCentavos(document.getElementById('prod-price').value),
          pieces_per_bundle: Number(document.getElementById('prod-pieces').value),
          piece_price_centavos: toCentavos(document.getElementById('prod-piece-price').value),
          low_stock_threshold_pieces: Number(document.getElementById('prod-threshold').value),
          image_url: document.getElementById('prod-image').value.trim(),
        };
        if (editingId) {
          await api.productUpdate(editingId, payload);
        } else {
          payload.initial_stock_pieces = Number(document.getElementById('prod-stock').value || 0);
          await api.productCreate(payload);
        }
        close();
        await load();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    load();
  });
})();
