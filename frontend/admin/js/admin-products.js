/**
 * admin-products: catalog table + add/edit modal + archive/restore + KPI metrics + category filters.
 *
 * WHAT: Lists products with live KPI counters, category filter pills,
 * instant search with debounce, image thumbnail previews, pagination, CSV export,
 * and in-page modal dialogs.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('products-tbody')) return; // not this page

    const ui = window.AdminUI;
    const api = window.AdminAPI;
    let editingId = null;
    let cachedProducts = [];
    let currentFilter = 'all';

    // Support deep link filter pre-selection (e.g., ?filter=out-of-stock or ?filter=low-stock)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const filterParam = urlParams.get('filter');
      if (filterParam) {
        const normalized = filterParam.replace(/-/g, '_').toLowerCase();
        if (['all', 'active', 'low_stock', 'out_of_stock', 'archived'].includes(normalized)) {
          currentFilter = normalized;
        }
      }
    } catch (_) {}

    let currentPage = 1;
    let searchDebounceTimer = null;

    const search = document.getElementById('catalog-search');
    const countLabel = document.getElementById('catalog-count');
    const sortSelect = document.getElementById('catalog-sort');
    const resetBtn = document.getElementById('btn-reset-filters');
    const clearSearchBtn = document.getElementById('btn-clear-search');
    const rowsPerPageSelect = document.getElementById('rows-per-page');
    const prevBtn = document.getElementById('btn-page-prev');
    const nextBtn = document.getElementById('btn-page-next');
    const pageNumberEl = document.getElementById('pagination-current-page');
    const paginationInfo = document.getElementById('pagination-info');
    const exportBtn = document.getElementById('btn-export-products-csv');

    const modal = () => document.getElementById('modal-product');
    const open = () => modal().classList.add('active');
    const close = () => {
      modal().classList.remove('active');
      document.getElementById('prod-image-preview-wrap').style.display = 'none';
    };

    /** Pesos string -> integer centavos (rounded, never float-stored). */
    function toCentavos(pesos) {
      return Math.round(Number(pesos) * 100);
    }

    function updateKpiCards(products) {
      const total = products.filter((p) => !p.is_archived).length;
      const inStock = products.filter((p) => !p.is_archived && p.stock_status === 'IN_STOCK').length;
      const lowStock = products.filter((p) => !p.is_archived && p.stock_status === 'LOW_STOCK').length;
      const outOfStock = products.filter((p) => !p.is_archived && (p.stock_status === 'OUT_OF_STOCK' || Number(p.stock_pieces) <= 0)).length;
      const archived = products.filter((p) => p.is_archived).length;

      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      // Top stat cards
      setEl('stat-total-products', total);
      setEl('stat-instock-products', inStock);
      setEl('stat-lowstock-products', lowStock);
      setEl('stat-outofstock-products', outOfStock);
      setEl('stat-archived-products', archived);

      // Filter pill badges
      setEl('badge-count-all', total);
      setEl('badge-count-active', inStock);
      setEl('badge-count-lowstock', lowStock);
      setEl('badge-count-outofstock', outOfStock);
      setEl('badge-count-archived', archived);
    }

    function updateResetVisibility() {
      const sortVal = sortSelect ? sortSelect.value : 'name_asc';
      const term = search ? search.value.trim() : '';
      const hasActiveFilters = currentFilter !== 'all' || term.length > 0 || sortVal !== 'name_asc';
      if (resetBtn) resetBtn.style.display = hasActiveFilters ? 'inline-flex' : 'none';
      if (clearSearchBtn) clearSearchBtn.style.display = term.length > 0 ? 'inline-block' : 'none';
    }

    function syncFilterUI() {
      // Sync stat cards
      document.querySelectorAll('#product-kpi-cards .stat-card').forEach((card) => {
        if (card.dataset.filter === currentFilter) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      });

      // Sync filter pills
      document.querySelectorAll('#catalog-filters [data-filter]').forEach((pill) => {
        if (pill.dataset.filter === currentFilter) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      });
    }

    function setFilter(filterKey) {
      currentFilter = filterKey;
      currentPage = 1;
      syncFilterUI();
      updateResetVisibility();
      renderTable();
    }

    async function load() {
      const tbody = document.getElementById('products-tbody');
      try {
        const { products } = await api.products(true);
        cachedProducts = products || [];
        updateKpiCards(cachedProducts);
        syncFilterUI();
        updateResetVisibility();
        renderTable();
        populateProductDropdowns(cachedProducts);
        const filterVal = document.getElementById('filter-history-product') ? document.getElementById('filter-history-product').value : null;
        await loadHistory(filterVal);
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" class="error-text">' + ui.esc(err.message) + '</td></tr>';
        if (countLabel) countLabel.textContent = 'Could not load products';
      }
    }

    function renderTable() {
      const tbody = document.getElementById('products-tbody');
      const term = (search ? search.value.trim().toLowerCase() : '');

      let filtered = cachedProducts.filter((p) => {
        // Category filter
        if (currentFilter === 'all' && p.is_archived) return false;
        if (currentFilter === 'active' && (p.is_archived || p.stock_status !== 'IN_STOCK')) return false;
        if (currentFilter === 'low_stock' && (p.is_archived || p.stock_status !== 'LOW_STOCK')) return false;
        if (currentFilter === 'out_of_stock' && (p.is_archived || (p.stock_status !== 'OUT_OF_STOCK' && Number(p.stock_pieces) > 0))) return false;
        if (currentFilter === 'archived' && !p.is_archived) return false;

        // Search text filter
        if (term) {
          const match = p.name.toLowerCase().includes(term) ||
            (p.description && p.description.toLowerCase().includes(term));
          if (!match) return false;
        }
        return true;
      });

      // Sorting
      const sortVal = sortSelect ? sortSelect.value : 'name_asc';
      filtered.sort((a, b) => {
        switch (sortVal) {
          case 'name_desc':
            return b.name.localeCompare(a.name);
          case 'price_asc':
            return (a.price_bundle_centavos || 0) - (b.price_bundle_centavos || 0);
          case 'price_desc':
            return (b.price_bundle_centavos || 0) - (a.price_bundle_centavos || 0);
          case 'stock_asc':
            return (Number(a.stock_pieces) || 0) - (Number(b.stock_pieces) || 0);
          case 'stock_desc':
            return (Number(b.stock_pieces) || 0) - (Number(a.stock_pieces) || 0);
          case 'name_asc':
          default:
            return a.name.localeCompare(b.name);
        }
      });

      const totalItems = filtered.length;

      // Handle Empty State
      if (!totalItems) {
        const isFiltered = term || currentFilter !== 'all' || sortVal !== 'name_asc';
        tbody.innerHTML = '<tr><td colspan="7" class="empty-table-state">' +
          '<i class="fas fa-box-open empty-state-icon"></i>' +
          '<div class="empty-state-title">' + (term ? 'No products match "' + ui.esc(term) + '"' : 'No products found') + '</div>' +
          '<div class="empty-state-desc">' + (isFiltered ? 'Try clearing your search or switching categories.' : 'Get started by creating your first bakery product.') + '</div>' +
          (isFiltered ? '<button type="button" class="btn btn-outline btn-sm" id="btn-empty-reset"><i class="fas fa-rotate-left"></i> Reset all filters</button>' : '') +
          '</td></tr>';

        const emptyResetBtn = document.getElementById('btn-empty-reset');
        if (emptyResetBtn) {
          emptyResetBtn.addEventListener('click', () => {
            if (resetBtn) resetBtn.click();
          });
        }

        if (countLabel) countLabel.textContent = '0 products matching';
        if (paginationInfo) paginationInfo.textContent = 'Showing 0–0 of 0 products';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (pageNumberEl) pageNumberEl.textContent = 'Page 1 of 1';
        return;
      }

      // Pagination calculation
      const pageSizeVal = rowsPerPageSelect ? rowsPerPageSelect.value : '25';
      const pageSize = pageSizeVal === 'all' ? totalItems : Math.max(1, parseInt(pageSizeVal, 10) || 25);
      const totalPages = Math.ceil(totalItems / pageSize) || 1;
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalItems);
      const pageItems = filtered.slice(startIndex, endIndex);

      // Update Pagination UI
      if (prevBtn) prevBtn.disabled = currentPage <= 1;
      if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
      if (pageNumberEl) pageNumberEl.textContent = 'Page ' + currentPage + ' of ' + totalPages;
      if (paginationInfo) {
        paginationInfo.textContent = 'Showing ' + (startIndex + 1) + '–' + endIndex + ' of ' + totalItems + ' products';
      }

      // Render table rows
      tbody.innerHTML = pageItems.map((p) => {
        const thumbHtml = p.image_url
          ? '<div class="catalog-product-thumb-box"><img src="' + ui.esc(p.image_url) + '" class="catalog-product-img" alt="' + ui.esc(p.name) + '" onerror="this.onerror=null;this.parentElement.innerHTML=\'<span class=\\\'catalog-product-icon\\\'><i class=\\\'fas fa-bread-slice\\\'></i></span>\';"></div>'
          : '<span class="catalog-product-icon"><i class="fas fa-bread-slice"></i></span>';

        const isOut = p.stock_status === 'OUT_OF_STOCK' || Number(p.stock_pieces) <= 0;
        const isLow = !isOut && p.stock_status === 'LOW_STOCK';
        const stockDotClass = isOut ? 'stock-out' : (isLow ? 'stock-low' : 'stock-ok');

        const statusBadge = p.is_archived
          ? '<span class="catalog-status-badge status-archived"><i class="fas fa-box-archive"></i> Archived</span>'
          : isOut
            ? '<span class="catalog-status-badge status-out"><i class="fas fa-circle-xmark"></i> Out of Stock</span>'
            : isLow
              ? '<span class="catalog-status-badge status-low"><i class="fas fa-triangle-exclamation"></i> Low Stock</span>'
              : '<span class="catalog-status-badge status-ok"><i class="fas fa-circle-check"></i> In Stock</span>';

        return '<tr' + (p.is_archived ? ' class="is-archived"' : '') + '>' +
          '<td class="col-product"><div class="catalog-product-name">' + thumbHtml +
          '<div class="catalog-name-meta"><strong>' + ui.esc(p.name) + '</strong>' +
          (p.is_archived
            ? '<small class="text-danger"><i class="fas fa-box-archive"></i> Archived from store</small>'
            : '<small class="text-muted">' + (p.description ? ui.esc(p.description.slice(0, 48) + (p.description.length > 48 ? '…' : '')) : 'Bakery Item #' + p.id) + '</small>') +
          '</div></div></td>' +
          '<td class="col-bundle-price text-right"><span class="catalog-price-bundle">' + ui.pesos(p.price_bundle_centavos) + '</span></td>' +
          '<td class="col-pcs-bundle col-center"><span class="catalog-pcs-pill">' + p.pieces_per_bundle + ' pcs</span></td>' +
          '<td class="col-piece-price text-right"><span class="catalog-price-piece">' + ui.pesos(p.piece_price_centavos) + '</span></td>' +
          '<td class="col-stock"><div class="catalog-stock-group">' +
          '<span class="stock-dot ' + stockDotClass + '" title="' + (isOut ? 'Depleted' : (isLow ? 'Below threshold' : 'Sufficient')) + '"></span>' +
          '<div class="stock-text-col"><strong class="stock-qty">' + Number(p.stock_pieces).toLocaleString() + ' pcs</strong><span class="stock-bdls">(' + Number(p.bundles_available || 0) + ' bdls)</span></div>' +
          '</div></td>' +
          '<td class="col-status col-center">' + statusBadge + '</td>' +
          '<td class="col-actions text-right actions-cell">' +
          '<div class="action-buttons-group">' +
          '<button type="button" class="btn-icon" data-edit="' + p.id + '" title="Edit product" aria-label="Edit product"><i class="fas fa-pen"></i></button>' +
          (!p.is_archived ? '<button type="button" class="btn-icon" data-adjust="' + p.id + '" title="Quick Stock Adjust" aria-label="Quick Stock Adjust"><i class="fas fa-sliders-h"></i></button>' : '') +
          '<button type="button" class="btn-icon" data-duplicate="' + p.id + '" title="Duplicate product" aria-label="Duplicate product"><i class="fas fa-copy"></i></button>' +
          (p.is_archived
            ? '<button type="button" class="btn-icon btn-icon-restore" data-restore="' + p.id + '" title="Restore to catalog" aria-label="Restore product"><i class="fas fa-rotate-left"></i></button>'
            : '<button type="button" class="btn-icon btn-icon-archive" data-archive="' + p.id + '" title="Archive product" aria-label="Archive product"><i class="fas fa-box-archive"></i></button>') +
          '</div>' +
          '</td></tr>';
      }).join('');

      if (countLabel) {
        countLabel.textContent = term || currentFilter !== 'all'
          ? 'Showing ' + filtered.length + ' of ' + cachedProducts.length + ' products'
          : cachedProducts.length + (cachedProducts.length === 1 ? ' product' : ' products');
      }
    }

    // Bind Stat Cards Click & Keyboard
    document.querySelectorAll('#product-kpi-cards .stat-card').forEach((card) => {
      card.addEventListener('click', () => setFilter(card.dataset.filter));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setFilter(card.dataset.filter);
        }
      });
    });

    // Bind Filter Pills Click
    document.querySelectorAll('#catalog-filters [data-filter]').forEach((pill) => {
      pill.addEventListener('click', () => setFilter(pill.dataset.filter));
    });

    // Debounced Search Input
    if (search) {
      search.addEventListener('input', () => {
        updateResetVisibility();
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          currentPage = 1;
          renderTable();
        }, 250);
      });
    }

    // Clear Search Button
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (search) search.value = '';
        currentPage = 1;
        updateResetVisibility();
        renderTable();
        if (search) search.focus();
      });
    }

    // Sort Dropdown
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        currentPage = 1;
        updateResetVisibility();
        renderTable();
      });
    }

    // Rows Per Page Dropdown
    if (rowsPerPageSelect) {
      rowsPerPageSelect.addEventListener('change', () => {
        currentPage = 1;
        renderTable();
      });
    }

    // Pagination Prev / Next Buttons
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          renderTable();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        currentPage++;
        renderTable();
      });
    }

    // Reset Filters Link
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        currentFilter = 'all';
        if (search) search.value = '';
        if (sortSelect) sortSelect.value = 'name_asc';
        currentPage = 1;
        syncFilterUI();
        updateResetVisibility();
        renderTable();
      });
    }

    // Export CSV
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        if (!cachedProducts || !cachedProducts.length) {
          ui.alert('No products available to export.', 'Export CSV');
          return;
        }
        const headers = [
          'ID',
          'Name',
          'Description',
          'Pieces Per Bundle',
          'Bundle Price (PHP)',
          'Piece Price (PHP)',
          'Stock Pieces',
          'Bundles Available',
          'Low Stock Threshold',
          'Stock Status',
          'Archived'
        ];

        const escapeCsv = (val) => {
          if (val === null || val === undefined) return '""';
          const str = String(val).replace(/"/g, '""');
          return `"${str}"`;
        };

        const rows = cachedProducts.map((p) => [
          p.id,
          escapeCsv(p.name),
          escapeCsv(p.description || ''),
          p.pieces_per_bundle,
          (p.price_bundle_centavos / 100).toFixed(2),
          (p.piece_price_centavos / 100).toFixed(2),
          p.stock_pieces,
          p.bundles_available || 0,
          p.low_stock_threshold_pieces,
          p.stock_status,
          p.is_archived ? 'Yes' : 'No'
        ].join(','));

        const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `webake-products-${today}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        ui.toast('Exported ' + cachedProducts.length + ' products to CSV.', 'success');
      });
    }

    // Image file selection & preview in modal
    const prodImgInput = document.getElementById('prod-image');
    const prodImgFile = document.getElementById('prod-image-file');
    const prodImgPreview = document.getElementById('prod-image-preview');
    const prodImgWrap = document.getElementById('prod-image-preview-wrap');
    const prodImgClear = document.getElementById('btn-clear-prod-image');
    const prodImgFilename = document.getElementById('prod-image-filename');

    if (prodImgFile) {
      prodImgFile.addEventListener('change', async () => {
        const file = prodImgFile.files && prodImgFile.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          ui.alert('Please select an image file (PNG, JPG, WebP, etc.).', 'Invalid File');
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          ui.alert('Image must be under 5MB in size.', 'File Too Large');
          return;
        }

        // 1. Show immediate local thumbnail preview
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (prodImgPreview) prodImgPreview.src = ev.target.result;
          if (prodImgWrap) prodImgWrap.style.display = 'flex';
          if (prodImgClear) prodImgClear.style.display = 'inline-block';
        };
        reader.readAsDataURL(file);

        // 2. Upload directly to Supabase product-images bucket via API
        if (prodImgFilename) prodImgFilename.innerHTML = '<i class="fas fa-spinner fa-spin text-primary"></i> Uploading to Supabase Storage...';
        try {
          const formData = new FormData();
          formData.append('image', file);
          const res = await api.productUploadImage(formData);
          if (res && res.image_url) {
            if (prodImgInput) prodImgInput.value = res.image_url;
            if (prodImgPreview) prodImgPreview.src = res.image_url;
            if (prodImgFilename) prodImgFilename.innerHTML = '<i class="fas fa-check-circle text-success"></i> Uploaded to Supabase product-images: ' + ui.esc(file.name);
            ui.toast('Image uploaded to Supabase Storage!', 'success');
          }
        } catch (err) {
          console.warn('Storage upload fallback:', err.message);
          if (prodImgFilename) prodImgFilename.innerHTML = '<i class="fas fa-info-circle text-muted"></i> Ready: ' + ui.esc(file.name);
        }
      });
    }

    if (prodImgInput) {
      prodImgInput.addEventListener('input', () => {
        const val = prodImgInput.value.trim();
        if (val) {
          if (prodImgPreview) prodImgPreview.src = val;
          if (prodImgWrap) prodImgWrap.style.display = 'flex';
          if (prodImgClear) prodImgClear.style.display = 'inline-block';
          if (prodImgFilename) prodImgFilename.textContent = 'Custom Image URL';
        } else {
          if (prodImgPreview) prodImgPreview.src = '';
          if (prodImgWrap) prodImgWrap.style.display = 'none';
        }
      });
    }

    if (prodImgClear) {
      prodImgClear.addEventListener('click', () => {
        if (prodImgInput) prodImgInput.value = '';
        if (prodImgFile) prodImgFile.value = '';
        if (prodImgPreview) prodImgPreview.src = '';
        if (prodImgWrap) prodImgWrap.style.display = 'none';
        prodImgClear.style.display = 'none';
      });
    }

    function openForCreate() {
      editingId = null;
      document.getElementById('product-modal-title').innerHTML = '<i class="fas fa-plus-circle text-primary"></i> Add New Product';
      document.getElementById('product-form').reset();
      document.getElementById('prod-pieces').value = 25;
      document.getElementById('prod-threshold').value = 500;
      document.getElementById('prod-stock-wrap').style.display = '';
      if (prodImgInput) prodImgInput.value = '';
      if (prodImgFile) prodImgFile.value = '';
      if (prodImgPreview) prodImgPreview.src = '';
      if (prodImgWrap) prodImgWrap.style.display = 'none';
      if (prodImgClear) prodImgClear.style.display = 'none';
      open();
    }

    async function openForEdit(id) {
      const p = cachedProducts.find((x) => String(x.id) === String(id));
      if (!p) return;
      editingId = p.id;
      document.getElementById('product-modal-title').innerHTML = '<i class="fas fa-pen text-primary"></i> Edit: ' + ui.esc(p.name);
      document.getElementById('prod-name').value = p.name;
      document.getElementById('prod-desc').value = p.description || '';
      document.getElementById('prod-price').value = (p.price_bundle_centavos / 100).toFixed(2);
      document.getElementById('prod-pieces').value = p.pieces_per_bundle;
      document.getElementById('prod-piece-price').value = (p.piece_price_centavos / 100).toFixed(2);
      document.getElementById('prod-threshold').value = p.low_stock_threshold_pieces;
      if (prodImgInput) prodImgInput.value = p.image_url || '';
      if (prodImgFile) prodImgFile.value = '';

      if (p.image_url && prodImgPreview) {
        prodImgPreview.src = p.image_url;
        if (prodImgWrap) prodImgWrap.style.display = 'flex';
        if (prodImgClear) prodImgClear.style.display = 'inline-block';
        if (prodImgFilename) prodImgFilename.textContent = 'Current image';
      } else {
        if (prodImgWrap) prodImgWrap.style.display = 'none';
        if (prodImgClear) prodImgClear.style.display = 'none';
      }

      // Stock adjusts on the Inventory page, never by editing the product.
      document.getElementById('prod-stock-wrap').style.display = 'none';
      open();
    }

    document.getElementById('products-tbody').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      const arch = e.target.closest('[data-archive]');
      const rest = e.target.closest('[data-restore]');
      const adj = e.target.closest('[data-adjust]');
      const dup = e.target.closest('[data-duplicate]');
      try {
        if (edit) { await openForEdit(edit.dataset.edit); return; }
        if (adj) {
          const prodSelect = document.getElementById('adjust-product');
          if (prodSelect) prodSelect.value = adj.dataset.adjust;
          const section = document.getElementById('section-stock-adjustment');
          if (section) section.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const qtyInput = document.getElementById('adjust-qty');
          if (qtyInput) { setTimeout(() => qtyInput.focus(), 300); }
          return;
        }
        if (dup) {
          const p = cachedProducts.find((x) => String(x.id) === String(dup.dataset.duplicate));
          if (p) {
            openForCreate();
            document.getElementById('prod-name').value = p.name + ' (Copy)';
            document.getElementById('prod-desc').value = p.description || '';
            document.getElementById('prod-price').value = (p.price_bundle_centavos / 100).toFixed(2);
            document.getElementById('prod-pieces').value = p.pieces_per_bundle;
            document.getElementById('prod-piece-price').value = (p.piece_price_centavos / 100).toFixed(2);
            document.getElementById('prod-threshold').value = p.low_stock_threshold_pieces;
            if (prodImgInput) prodImgInput.value = p.image_url || '';
            if (p.image_url && prodImgPreview) {
              prodImgPreview.src = p.image_url;
              if (prodImgWrap) prodImgWrap.style.display = 'flex';
            }
            ui.toast('Duplicating product "' + p.name + '". Review and save.', 'info');
          }
          return;
        }
        if (arch && ui.confirmAsk('Archive this product? It will be hidden from the customer storefront and Walk-In register, but past order history remains preserved.')) {
          await api.productArchive(arch.dataset.archive);
          ui.toast('Product archived.', 'info');
          await load();
        }
        if (rest) {
          await api.productRestore(rest.dataset.restore);
          ui.toast('Product restored to catalog.', 'success');
          await load();
        }
      } catch (err) {
        ui.alert(err.message, 'Product Action Failed');
      }
    });

    document.getElementById('btn-add-product').addEventListener('click', openForCreate);
    document.getElementById('btn-close-product').addEventListener('click', close);
    const cancelBtn = document.getElementById('btn-cancel-product');
    if (cancelBtn) cancelBtn.addEventListener('click', close);
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
          ui.toast('Product "' + payload.name + '" updated successfully!', 'success');
        } else {
          payload.initial_stock_pieces = Number(document.getElementById('prod-stock').value || 0);
          await api.productCreate(payload);
          ui.toast('Product "' + payload.name + '" added to catalog!', 'success');
        }
        close();
        await load();
      } catch (err) {
        ui.alert(err.message, 'Save Product Failed');
      } finally {
        btn.disabled = false;
      }
    });

    function populateProductDropdowns(products) {
      const active = (products || []).filter((p) => !p.is_archived);
      const adjSelect = document.getElementById('adjust-product');
      const histSelect = document.getElementById('filter-history-product');

      if (adjSelect) {
        const currentVal = adjSelect.value;
        adjSelect.innerHTML = active.map((p) =>
          '<option value="' + p.id + '">' + ui.esc(p.name) + ' (' + p.stock_pieces + ' pcs / ' + Number(p.bundles_available || 0) + ' bdls)</option>'
        ).join('');
        if (currentVal && active.some((p) => String(p.id) === String(currentVal))) {
          adjSelect.value = currentVal;
        }
      }

      if (histSelect) {
        const currentHist = histSelect.value;
        histSelect.innerHTML = '<option value="">All Products</option>' +
          (products || []).map((p) =>
            '<option value="' + p.id + '">' + ui.esc(p.name) + '</option>'
          ).join('');
        if (currentHist) histSelect.value = currentHist;
      }
    }

    async function loadHistory(productId) {
      const tbody = document.getElementById('inventory-history-tbody');
      if (!tbody) return;
      try {
        const { movements } = await api.movements(productId || null, 100);
        if (!movements || !movements.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:1.5rem;">No stock movements recorded yet.</td></tr>';
          return;
        }
        tbody.innerHTML = movements.map((m) => {
          const changeStr = (m.change_pieces > 0 ? '+' : '') + m.change_pieces + ' pcs';
          const changeBadge = m.change_pieces > 0
            ? '<strong style="color:var(--success, #2e7d32);">' + changeStr + '</strong>'
            : '<strong style="color:var(--danger, #c62828);">' + changeStr + '</strong>';
          return '<tr>' +
            '<td>' + ui.fmtDate(m.created_at) + '</td>' +
            '<td><span class="catalog-pcs-pill">' + ui.esc(m.reason || '-') + '</span></td>' +
            '<td><strong>' + ui.esc(m.product_name || ('#' + m.product_id)) + '</strong></td>' +
            '<td>' + changeBadge + '</td>' +
            '<td>' + ui.esc(m.note || '-') + '</td>' +
            '</tr>';
        }).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" class="error-text" style="text-align:center;padding:1.5rem;">Failed to load audit history: ' + ui.esc(err.message) + '</td></tr>';
      }
    }

    const histFilterEl = document.getElementById('filter-history-product');
    if (histFilterEl) {
      histFilterEl.addEventListener('change', () => {
        loadHistory(histFilterEl.value || null);
      });
    }

    const adjustForm = document.getElementById('form-adjust-stock');
    if (adjustForm) {
      adjustForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('adjust-product').value;
        const unit = document.getElementById('adjust-unit').value;
        const mode = document.getElementById('adjust-mode').value;
        let qty = Number(document.getElementById('adjust-qty').value);
        const product = cachedProducts.find((p) => String(p.id) === String(id));
        const ppb = (product && product.pieces_per_bundle) || 25;
        if (unit === 'bundles') {
          qty = Math.round(qty * ppb);
        }
        const payload = {
          reason: document.getElementById('adjust-reason').value,
          note: document.getElementById('adjust-note').value.trim(),
        };
        if (mode === 'set') {
          payload.set_pieces = qty;
        } else {
          payload.change_pieces = qty;
        }

        const submitBtn = document.getElementById('btn-submit-adjust');
        if (submitBtn) submitBtn.disabled = true;

        try {
          await api.adjustStock(id, payload);
          ui.toast('Stock updated and logged.', 'success');
          document.getElementById('adjust-qty').value = 0;
          document.getElementById('adjust-note').value = '';
          await load();
        } catch (err) {
          ui.alert(err.message, 'Adjustment Failed');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    load();
  });
})();
