/**
 * admin-ingredients.js — Ingredients & Raw Inventory Management
 *
 * Safe: stock modifications are funneled exclusively through the PostgreSQL
 * RPC function `adjust_stock` via AdminAPI. Client-side direct updates to stock
 * are impossible. Double-submit protection, decimal support, and audit history.
 */

(function () {
  'use strict';

  // --- State ---
  let ingredients = [];
  let summary = { total: 0, low_stock: 0, out_of_stock: 0, expiring_soon: 0 };
  let currentFilter = 'all';
  let searchQuery = '';
  let activeHistoryIngredient = null;
  let historyPage = 0;
  const HISTORY_LIMIT = 10;

  // --- DOM Elements ---
  const tbody = document.getElementById('ingredients-tbody');
  const countLabel = document.getElementById('catalog-count');
  const searchInput = document.getElementById('ingredient-search');
  const filterPills = document.querySelectorAll('#ingredient-filters .pos-filter-pill');

  // Stats
  const statTotal = document.getElementById('stat-total-ingredients');
  const statLow = document.getElementById('stat-lowstock-ingredients');
  const statOut = document.getElementById('stat-outofstock-ingredients');
  const statExpiring = document.getElementById('stat-expiring-ingredients');

  // Modals & Forms
  const modalIng = document.getElementById('modal-ingredient');
  const formIng = document.getElementById('ingredient-form');
  const btnCloseIng = document.getElementById('btn-close-ingredient');
  const btnCancelIng = document.getElementById('btn-cancel-ingredient');
  const btnAddIng = document.getElementById('btn-add-ingredient');
  const ingModalTitle = document.getElementById('ingredient-modal-title');
  const wrapInitialStock = document.getElementById('wrap-initial-stock');

  const modalRestock = document.getElementById('modal-restock');
  const formRestock = document.getElementById('restock-form');
  const btnCloseRestock = document.getElementById('btn-close-restock');
  const btnCancelRestock = document.getElementById('btn-cancel-restock');

  const modalAdjust = document.getElementById('modal-adjust');
  const formAdjust = document.getElementById('adjust-form');
  const btnCloseAdjust = document.getElementById('btn-close-adjust');
  const btnCancelAdjust = document.getElementById('btn-cancel-adjust');

  const modalHistory = document.getElementById('modal-history');
  const btnCloseHistory = document.getElementById('btn-close-history');
  const btnDismissHistory = document.getElementById('btn-dismiss-history');
  const historyTbody = document.getElementById('history-tbody');
  const btnHistPrev = document.getElementById('btn-history-prev');
  const btnHistNext = document.getElementById('btn-history-next');
  const histPageInfo = document.getElementById('history-page-info');

  const btnExportCsv = document.getElementById('btn-export-csv');

  // --- Helpers ---
  function formatNumber(num) {
    if (num == null || isNaN(num)) return '0';
    const n = Number(num);
    // Show up to 3 decimals, trimming trailing zeros
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }

  function formatPesos(cost) {
    if (cost == null || cost === '' || isNaN(cost)) return '—';
    return '₱' + Number(cost).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(dStr) {
    if (!dStr) return '—';
    const clean = String(dStr).split('T')[0];
    const parts = clean.split('-');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    }
    return '—';
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function openModal(el) {
    if (el) el.classList.add('active');
  }

  function closeModal(el) {
    if (el) el.classList.remove('active');
  }

  function setSubmitting(btn, isSubmitting, text = 'Processing…') {
    if (!btn) return;
    btn.disabled = isSubmitting;
    if (isSubmitting) {
      btn._origHtml = btn.innerHTML;
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
    } else if (btn._origHtml) {
      btn.innerHTML = btn._origHtml;
    }
  }

  // --- Data Loading ---
  async function loadIngredients() {
    try {
      countLabel.textContent = 'Loading ingredients…';
      const res = await AdminAPI.ingredients();
      ingredients = res.ingredients || [];
      summary = res.summary || { total: 0, low_stock: 0, out_of_stock: 0, expiring_soon: 0 };
      renderSummary();
      renderTable();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--danger, #dc3545);">
        <i class="fas fa-exclamation-triangle"></i> Failed to load ingredients: ${AdminUI.esc(err.message)}
      </td></tr>`;
      countLabel.textContent = 'Error loading inventory';
      AdminUI.toast('Could not load ingredients list.', 'danger');
    }
  }

  function renderSummary() {
    statTotal.textContent = summary.total != null ? summary.total : ingredients.length;
    statLow.textContent = summary.low_stock != null ? summary.low_stock : 0;
    statOut.textContent = summary.out_of_stock != null ? summary.out_of_stock : 0;
    statExpiring.textContent = summary.expiring_soon != null ? summary.expiring_soon : 0;
  }

  // --- Table Rendering ---
  function renderTable() {
    tbody.innerHTML = '';

    const q = searchQuery.toLowerCase().trim();
    const filtered = ingredients.filter((ing) => {
      // Search filter
      const matchSearch = !q || ing.name.toLowerCase().includes(q);
      if (!matchSearch) return false;

      // Status pill filter
      if (currentFilter === 'archived') return ing.is_archived === true;
      if (ing.is_archived) return false;

      if (currentFilter === 'in_stock') return ing.stock_status === 'in_stock';
      if (currentFilter === 'low_stock') return ing.stock_status === 'low_stock';
      if (currentFilter === 'out_of_stock') return ing.stock_status === 'out_of_stock';
      if (currentFilter === 'expiring_soon') return ing.is_expiring_soon;
      return true;
    });

    countLabel.textContent = `Showing ${filtered.length} of ${ingredients.length} ingredients`;

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.style.textAlign = 'center';
      td.style.padding = '2.5rem 1rem';
      td.className = 'muted';
      td.innerHTML = ingredients.length === 0
        ? '<i class="fas fa-box-open" style="font-size:2rem; margin-bottom:0.5rem; display:block; opacity:0.5;"></i>No ingredients yet. Click "Add Ingredient" to start tracking.'
        : '<i class="fas fa-filter" style="font-size:2rem; margin-bottom:0.5rem; display:block; opacity:0.5;"></i>No ingredients match the selected filter or search.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    filtered.forEach((ing) => {
      const tr = document.createElement('tr');

      // 1. Name & Packaging Unit
      const tdName = document.createElement('td');
      tdName.className = 'col-ingredient';
      tdName.innerHTML = `
        <div class="catalog-product-name">
          <span class="catalog-product-icon"><i class="fas fa-wheat-awn"></i></span>
          <div class="catalog-name-meta">
            <strong>${AdminUI.esc(ing.name)}</strong>
            <small class="text-muted">Unit: ${AdminUI.esc(ing.unit || 'pcs')}</small>
          </div>
        </div>
      `;
      tr.appendChild(tdName);

      // 2. Stock & Reorder Level
      const isOut = ing.stock_status === 'out_of_stock';
      const isLow = !isOut && ing.stock_status === 'low_stock';
      const stockDotClass = isOut ? 'stock-out' : (isLow ? 'stock-low' : 'stock-ok');

      const tdStock = document.createElement('td');
      tdStock.className = 'col-ing-stock';
      tdStock.innerHTML = `
        <div class="catalog-stock-group">
          <span class="stock-dot ${stockDotClass}"></span>
          <div class="stock-text-col">
            <strong class="stock-qty">${formatNumber(ing.stock_quantity)} ${AdminUI.esc(ing.unit || 'pcs')}</strong>
            <span class="stock-reorder-sub">Reorder at &le; ${formatNumber(ing.reorder_level)} ${AdminUI.esc(ing.unit || 'pcs')}</span>
          </div>
        </div>
      `;
      tr.appendChild(tdStock);

      // 3. Cost / Unit
      const tdCost = document.createElement('td');
      tdCost.className = 'col-ing-cost';
      tdCost.innerHTML = `
        <div class="cost-unit-text">
          <strong>${formatPesos(ing.cost_per_unit)}</strong>
          <span class="unit-label">/ ${AdminUI.esc(ing.unit || 'pcs')}</span>
        </div>
      `;
      tr.appendChild(tdCost);

      // 4. Expiry Date
      const tdExpiry = document.createElement('td');
      tdExpiry.className = 'col-ing-expiry';
      const expDateStr = formatDate(ing.expiry_date);
      tdExpiry.innerHTML = `
        <div class="expiry-date-text">${expDateStr}</div>
        ${ing.is_expiring_soon ? '<div style="margin-top:2px;"><span class="tag-expiring"><i class="far fa-clock"></i> Expiring Soon</span></div>' : ''}
      `;
      tr.appendChild(tdExpiry);

      // 5. Status Badge
      const tdStatus = document.createElement('td');
      tdStatus.className = 'col-ing-status col-center';
      tdStatus.style.textAlign = 'center';
      let badgeClass = 'status-ok';
      let badgeText = 'In Stock';
      let badgeIcon = 'fa-circle-check';

      if (ing.is_archived) {
        badgeClass = 'status-archived';
        badgeText = 'Archived';
        badgeIcon = 'fa-box-archive';
      } else if (isOut) {
        badgeClass = 'status-out';
        badgeText = 'Out of Stock';
        badgeIcon = 'fa-circle-xmark';
      } else if (isLow) {
        badgeClass = 'status-low';
        badgeText = 'Low Stock';
        badgeIcon = 'fa-triangle-exclamation';
      }
      tdStatus.innerHTML = `<span class="catalog-status-badge ${badgeClass}"><i class="fas ${badgeIcon}"></i> ${badgeText}</span>`;
      tr.appendChild(tdStatus);

      // 6. Actions
      const tdActions = document.createElement('td');
      tdActions.className = 'col-ing-actions actions-cell';
      tdActions.style.textAlign = 'right';

      const actionsGroup = document.createElement('div');
      actionsGroup.className = 'action-buttons-group';

      if (ing.is_archived) {
        // Archived: view history, unarchive, or permanently delete
        const btnHist = document.createElement('button');
        btnHist.type = 'button';
        btnHist.className = 'btn-icon';
        btnHist.innerHTML = '<i class="fas fa-clock-rotate-left"></i>';
        btnHist.title = 'Audit trail & movements';
        btnHist.setAttribute('aria-label', 'Audit trail');
        btnHist.addEventListener('click', () => openHistoryModal(ing));

        const btnUnarchive = document.createElement('button');
        btnUnarchive.type = 'button';
        btnUnarchive.className = 'btn-icon';
        btnUnarchive.innerHTML = '<i class="fas fa-box-open"></i>';
        btnUnarchive.title = 'Unarchive ingredient';
        btnUnarchive.setAttribute('aria-label', 'Unarchive ingredient');
        btnUnarchive.addEventListener('click', () => unarchiveIngredient(ing));

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-icon btn-icon-archive';
        btnDel.innerHTML = '<i class="fas fa-trash"></i>';
        btnDel.title = 'Permanently delete';
        btnDel.setAttribute('aria-label', 'Permanently delete');
        btnDel.addEventListener('click', () => deleteIngredient(ing));

        actionsGroup.appendChild(btnHist);
        actionsGroup.appendChild(btnUnarchive);
        actionsGroup.appendChild(btnDel);
      } else {
        // Active: Restock, Adjust, History, Edit, Archive
        const btnRestock = document.createElement('button');
        btnRestock.type = 'button';
        btnRestock.className = 'btn btn-primary btn-sm';
        btnRestock.innerHTML = '<i class="fas fa-plus"></i> Restock';
        btnRestock.title = 'Add stock (purchase / batch intake)';
        btnRestock.addEventListener('click', () => openRestockModal(ing));

        const btnAdj = document.createElement('button');
        btnAdj.type = 'button';
        btnAdj.className = 'btn btn-outline btn-sm';
        btnAdj.innerHTML = '<i class="fas fa-sliders-h"></i> Adjust';
        btnAdj.title = 'Remove stock (usage, damage, correction)';
        btnAdj.addEventListener('click', () => openAdjustModal(ing));

        const btnHist = document.createElement('button');
        btnHist.type = 'button';
        btnHist.className = 'btn-icon';
        btnHist.innerHTML = '<i class="fas fa-clock-rotate-left"></i>';
        btnHist.title = 'Audit trail & movements';
        btnHist.setAttribute('aria-label', 'Audit trail');
        btnHist.addEventListener('click', () => openHistoryModal(ing));

        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'btn-icon';
        btnEdit.innerHTML = '<i class="fas fa-pen"></i>';
        btnEdit.title = 'Edit details';
        btnEdit.setAttribute('aria-label', 'Edit ingredient');
        btnEdit.addEventListener('click', () => openEditModal(ing));

        const btnArchive = document.createElement('button');
        btnArchive.type = 'button';
        btnArchive.className = 'btn-icon btn-icon-archive';
        btnArchive.innerHTML = '<i class="fas fa-box-archive"></i>';
        btnArchive.title = 'Archive ingredient';
        btnArchive.setAttribute('aria-label', 'Archive ingredient');
        btnArchive.addEventListener('click', () => archiveIngredient(ing));

        actionsGroup.appendChild(btnRestock);
        actionsGroup.appendChild(btnAdj);
        actionsGroup.appendChild(btnHist);
        actionsGroup.appendChild(btnEdit);
        actionsGroup.appendChild(btnArchive);
      }

      tdActions.appendChild(actionsGroup);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
  }

  // --- Filter Pills & Search ---
  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.getAttribute('data-filter') || 'all';
      // Sync stat cards active state
      document.querySelectorAll('#ingredient-kpi-cards .stat-card').forEach((c) => {
        c.classList.toggle('active', (c.dataset.filter || 'all') === currentFilter);
      });
      renderTable();
    });
  });

  // Sync click on ingredient stat cards
  document.querySelectorAll('#ingredient-kpi-cards .stat-card').forEach((card) => {
    card.addEventListener('click', () => {
      const filter = card.dataset.filter;
      if (!filter) return;
      const targetPill = document.querySelector(`#ingredient-filters .pos-filter-pill[data-filter="${filter}"]`);
      if (targetPill) targetPill.click();
    });
  });

  // Support URL query param filter pre-selection (e.g. ?filter=low-stock or ?filter=out-of-stock)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const filterParam = urlParams.get('filter');
    if (filterParam) {
      const normalized = filterParam.replace(/-/g, '_').toLowerCase();
      if (['all', 'in_stock', 'low_stock', 'out_of_stock', 'expiring_soon'].includes(normalized)) {
        currentFilter = normalized;
        filterPills.forEach((p) => {
          if (p.getAttribute('data-filter') === currentFilter) {
            p.classList.add('active');
          } else {
            p.classList.remove('active');
          }
        });
      }
    }
  } catch (_) {}

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTable();
  });

  // --- Add / Edit Ingredient Modal ---
  function openCreateModal() {
    formIng.reset();
    document.getElementById('ingredient-id').value = '';
    ingModalTitle.innerHTML = '<i class="fas fa-wheat-awn text-primary"></i> Add Ingredient';
    wrapInitialStock.style.display = 'block';
    document.getElementById('ing-initial-stock').disabled = false;
    openModal(modalIng);
    document.getElementById('ing-name').focus();
  }

  function openEditModal(ing) {
    formIng.reset();
    document.getElementById('ingredient-id').value = ing.id;
    ingModalTitle.innerHTML = `<i class="fas fa-pencil text-primary"></i> Edit: ${AdminUI.esc(ing.name)}`;
    document.getElementById('ing-name').value = ing.name || '';
    document.getElementById('ing-unit').value = ing.unit || 'sack';
    document.getElementById('ing-reorder').value = ing.reorder_level != null ? ing.reorder_level : 0;
    document.getElementById('ing-cost').value = ing.cost_per_unit != null ? ing.cost_per_unit : '';
    document.getElementById('ing-expiry').value = ing.expiry_date ? String(ing.expiry_date).split('T')[0] : '';

    // Per rules: cannot edit stock_quantity here! Changes must go through adjust_stock RPC
    wrapInitialStock.style.display = 'none';
    document.getElementById('ing-initial-stock').disabled = true;

    openModal(modalIng);
  }

  formIng.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSave = document.getElementById('btn-save-ingredient');
    setSubmitting(btnSave, true);

    const id = document.getElementById('ingredient-id').value;
    const isEdit = Boolean(id);

    const payload = {
      name: document.getElementById('ing-name').value.trim(),
      unit: document.getElementById('ing-unit').value.trim() || 'pcs',
      reorder_level: Number(document.getElementById('ing-reorder').value) || 0,
      cost_per_unit: document.getElementById('ing-cost').value !== '' ? Number(document.getElementById('ing-cost').value) : null,
      expiry_date: document.getElementById('ing-expiry').value || null,
    };

    if (!isEdit) {
      payload.stock_quantity = Number(document.getElementById('ing-initial-stock').value) || 0;
    }

    try {
      if (isEdit) {
        await AdminAPI.ingredientUpdate(id, payload);
        AdminUI.toast('Ingredient updated successfully!', 'success');
      } else {
        await AdminAPI.ingredientCreate(payload);
        AdminUI.toast('New ingredient added to inventory!', 'success');
      }
      closeModal(modalIng);
      await loadIngredients();
    } catch (err) {
      AdminUI.toast(err.message || 'Failed to save ingredient.', 'danger');
    } finally {
      setSubmitting(btnSave, false);
    }
  });

  btnAddIng.addEventListener('click', openCreateModal);
  btnCloseIng.addEventListener('click', () => closeModal(modalIng));
  btnCancelIng.addEventListener('click', () => closeModal(modalIng));

  // --- Add Stock (Restock) Modal ---
  function openRestockModal(ing) {
    formRestock.reset();
    document.getElementById('restock-ing-id').value = ing.id;
    document.getElementById('restock-ing-name').textContent = ing.name;
    document.getElementById('restock-current-stock').textContent = formatNumber(ing.stock_quantity);
    document.getElementById('restock-unit-label').textContent = ing.unit || 'pcs';
    if (ing.cost_per_unit) document.getElementById('restock-unit-cost').value = ing.cost_per_unit;
    openModal(modalRestock);
    document.getElementById('restock-qty').focus();
  }

  formRestock.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-restock');
    const id = document.getElementById('restock-ing-id').value;
    const qty = Number(document.getElementById('restock-qty').value);

    if (!qty || qty <= 0 || isNaN(qty)) {
      AdminUI.toast('Please enter a valid quantity greater than 0.', 'danger');
      return;
    }

    setSubmitting(btnSubmit, true, 'Restocking…');

    const payload = {
      type: 'restock',
      quantity: qty,
      unit_cost: document.getElementById('restock-unit-cost').value !== '' ? Number(document.getElementById('restock-unit-cost').value) : null,
      reason: document.getElementById('restock-note').value.trim() || 'Restock delivery',
    };

    try {
      const res = await AdminAPI.ingredientAdjustStock(id, payload);
      AdminUI.toast(`Restocked! New balance: ${formatNumber(res.ingredient.stock_quantity)} ${res.ingredient.unit}`, 'success');
      closeModal(modalRestock);
      await loadIngredients();
    } catch (err) {
      AdminUI.toast(err.message || 'Restock operation failed.', 'danger');
    } finally {
      setSubmitting(btnSubmit, false);
    }
  });

  btnCloseRestock.addEventListener('click', () => closeModal(modalRestock));
  btnCancelRestock.addEventListener('click', () => closeModal(modalRestock));

  // --- Remove / Adjust Modal ---
  function openAdjustModal(ing) {
    formAdjust.reset();
    document.getElementById('adjust-ing-id').value = ing.id;
    document.getElementById('adjust-ing-name').textContent = ing.name;
    document.getElementById('adjust-current-stock').textContent = formatNumber(ing.stock_quantity);
    document.getElementById('adjust-unit-label').textContent = ing.unit || 'pcs';
    openModal(modalAdjust);
    document.getElementById('adjust-qty').focus();
  }

  formAdjust.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-adjust');
    const id = document.getElementById('adjust-ing-id').value;
    const type = document.getElementById('adjust-type').value;
    const qty = Number(document.getElementById('adjust-qty').value);
    const reason = document.getElementById('adjust-reason').value.trim();

    if (!qty || qty <= 0 || isNaN(qty)) {
      AdminUI.toast('Please enter a positive removal quantity.', 'danger');
      return;
    }

    if (!reason) {
      AdminUI.toast('A reason is strictly mandatory for stock removals.', 'danger');
      document.getElementById('adjust-reason').focus();
      return;
    }

    setSubmitting(btnSubmit, true, 'Applying…');

    try {
      const res = await AdminAPI.ingredientAdjustStock(id, {
        type,
        quantity: qty,
        reason,
      });
      AdminUI.toast(`Deduction recorded! Remaining stock: ${formatNumber(res.ingredient.stock_quantity)} ${res.ingredient.unit}`, 'success');
      closeModal(modalAdjust);
      await loadIngredients();
    } catch (err) {
      // Translate database constraint errors into user-friendly message
      if (err.message && err.message.toLowerCase().includes('insufficient')) {
        AdminUI.toast(`Insufficient stock: Cannot remove ${qty}. Check available balance.`, 'danger');
      } else {
        AdminUI.toast(err.message || 'Stock adjustment failed.', 'danger');
      }
    } finally {
      setSubmitting(btnSubmit, false);
    }
  });

  btnCloseAdjust.addEventListener('click', () => closeModal(modalAdjust));
  btnCancelAdjust.addEventListener('click', () => closeModal(modalAdjust));

  // --- History / Audit Modal ---
  async function openHistoryModal(ing) {
    activeHistoryIngredient = ing;
    historyPage = 0;
    document.getElementById('history-ing-name').textContent = ing.name;
    document.getElementById('history-current-stock').textContent = formatNumber(ing.stock_quantity);
    document.getElementById('history-unit-label').textContent = ing.unit || 'pcs';
    openModal(modalHistory);
    await loadHistory();
  }

  async function loadHistory() {
    if (!activeHistoryIngredient) return;
    historyTbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center; padding:1.5rem;"><i class="fas fa-spinner fa-spin"></i> Loading audit trail…</td></tr>';

    try {
      const offset = historyPage * HISTORY_LIMIT;
      const res = await AdminAPI.ingredientMovements(activeHistoryIngredient.id, HISTORY_LIMIT, offset);
      const rows = res.movements || [];
      const total = res.total || 0;

      const totalPages = Math.max(1, Math.ceil(total / HISTORY_LIMIT));
      histPageInfo.textContent = `Page ${historyPage + 1} of ${totalPages} (${total} total movements)`;
      btnHistPrev.disabled = historyPage <= 0;
      btnHistNext.disabled = historyPage + 1 >= totalPages;

      if (rows.length === 0) {
        historyTbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center; padding:1.5rem;">No recorded movements yet for this ingredient.</td></tr>';
        return;
      }

      historyTbody.innerHTML = '';
      rows.forEach((m) => {
        const tr = document.createElement('tr');

        // Date
        const tdDate = document.createElement('td');
        tdDate.textContent = formatDateTime(m.created_at);
        tr.appendChild(tdDate);

        // Type
        const tdType = document.createElement('td');
        const badgeType = m.movement_type || 'adjustment';
        tdType.innerHTML = `<span class="badge-movement badge-${badgeType}">${AdminUI.esc(badgeType)}</span>`;
        tr.appendChild(tdType);

        // Change
        const tdChange = document.createElement('td');
        const isPos = Number(m.quantity_change) > 0;
        tdChange.style.fontWeight = '700';
        tdChange.style.color = isPos ? '#1B5E20' : '#C62828';
        tdChange.textContent = (isPos ? '+' : '') + formatNumber(m.quantity_change);
        tr.appendChild(tdChange);

        // Before -> After
        const tdBal = document.createElement('td');
        tdBal.style.whiteSpace = 'nowrap';
        tdBal.textContent = `${formatNumber(m.quantity_before)} → ${formatNumber(m.quantity_after)}`;
        tr.appendChild(tdBal);

        // Cost
        const tdCost = document.createElement('td');
        tdCost.textContent = m.unit_cost ? formatPesos(m.unit_cost) : '—';
        tr.appendChild(tdCost);

        // Reason / Note
        const tdReason = document.createElement('td');
        tdReason.textContent = m.reason || '—';
        tr.appendChild(tdReason);

        // User
        const tdUser = document.createElement('td');
        tdUser.textContent = m.created_by || 'admin';
        tr.appendChild(tdUser);

        historyTbody.appendChild(tr);
      });
    } catch (err) {
      historyTbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger, #dc3545); text-align:center; padding:1.5rem;">
        Failed to load movement logs: ${AdminUI.esc(err.message)}
      </td></tr>`;
    }
  }

  btnHistPrev.addEventListener('click', async () => {
    if (historyPage > 0) {
      historyPage--;
      await loadHistory();
    }
  });

  btnHistNext.addEventListener('click', async () => {
    historyPage++;
    await loadHistory();
  });

  btnCloseHistory.addEventListener('click', () => closeModal(modalHistory));
  btnDismissHistory.addEventListener('click', () => closeModal(modalHistory));

  // --- Archive, Unarchive & Permanent Delete ---
  async function archiveIngredient(ing) {
    const ok = AdminUI.confirmAsk(`Archive "${ing.name}"? It will be marked as inactive and moved to the Archived section.`);
    if (!ok) return;

    try {
      await AdminAPI.ingredientArchive(ing.id);
      AdminUI.toast(`Archived "${ing.name}".`, 'info');
      await loadIngredients();
    } catch (err) {
      AdminUI.toast(err.message || 'Could not archive ingredient.', 'danger');
    }
  }

  async function unarchiveIngredient(ing) {
    try {
      await AdminAPI.ingredientUnarchive(ing.id);
      AdminUI.toast(`Unarchived "${ing.name}".`, 'success');
      await loadIngredients();
    } catch (err) {
      AdminUI.toast(err.message || 'Could not unarchive ingredient.', 'danger');
    }
  }

  async function deleteIngredient(ing) {
    const ok = AdminUI.confirmAsk(`Permanently delete "${ing.name}"? This removes the ingredient and cannot be undone.`);
    if (!ok) return;

    try {
      await AdminAPI.ingredientDelete(ing.id);
      AdminUI.toast(`Deleted "${ing.name}".`, 'info');
      await loadIngredients();
    } catch (err) {
      AdminUI.toast(err.message || 'Could not delete ingredient.', 'danger');
    }
  }

  // --- Export to CSV ---
  btnExportCsv.addEventListener('click', () => {
    if (!ingredients || ingredients.length === 0) {
      AdminUI.toast('No ingredients to export.', 'info');
      return;
    }

    const headers = [
      'ID', 'Name', 'Stock Quantity', 'Unit', 'Reorder Threshold',
      'Cost Per Unit (PHP)', 'Expiry Date', 'Stock Status'
    ];

    const rows = ingredients.map((i) => [
      i.id,
      `"${String(i.name || '').replace(/"/g, '""')}"`,
      i.stock_quantity,
      `"${String(i.unit || '').replace(/"/g, '""')}"`,
      i.reorder_level,
      i.cost_per_unit || '',
      i.expiry_date || '',
      i.stock_status || ''
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `webake_ingredients_inventory_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    AdminUI.toast('Inventory exported to CSV!', 'success');
  });

  // --- Close Modals on Backdrop Click or ESC ---
  [modalIng, modalRestock, modalAdjust, modalHistory].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      [modalIng, modalRestock, modalAdjust, modalHistory].forEach(closeModal);
    }
  });

  // --- Init ---
  document.addEventListener('DOMContentLoaded', loadIngredients);
})();

