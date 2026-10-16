/**
 * admin-dashboard.js — WeBake Admin Dashboard
 *
 * Implements the 6 required dashboard sections in order:
 * 1. Summary Cards (Today's Sales, Awaiting Verification, Possible Collection)
 * 2. Orders by Status
 * 3. Low Stock Alerts (Products & Ingredients)
 * 4. Recent Orders
 * 5. Sales Report (View & PDF Export)
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('stat-combined')) return;

    const ui = window.AdminUI;
    const api = window.AdminAPI;

    // Defined WeBake order lifecycle statuses and badge styles
    const ORDER_STATUS_CONFIG = [
      { key: 'PAYMENT_UNDER_VERIFICATION', label: 'Under Verification', badgeClass: 'badge-status-blue' },
      { key: 'CONFIRMED', label: 'Confirmed', badgeClass: 'badge-status-amber' },
      { key: 'IN_PRODUCTION', label: 'In Production', badgeClass: 'badge-status-purple' },
      { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', badgeClass: 'badge-status-orange' },
      { key: 'COMPLETED', label: 'Completed', badgeClass: 'badge-status-green' },
      { key: 'CANCELLED', label: 'Cancelled', badgeClass: 'badge-status-red' },
    ];

    function formatNumber(num) {
      if (num == null || isNaN(num)) return '0';
      const n = Number(num);
      return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    }

    function renderStatusBadge(status) {
      const cfg = ORDER_STATUS_CONFIG.find((c) => c.key === status);
      if (cfg) {
        return `<span class="badge-status ${cfg.badgeClass}">${cfg.label}</span>`;
      }
      return ui.pill(status);
    }

    function set(id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    }

    // Set default date for report anchor
    const anchorInput = document.getElementById('report-anchor');
    if (anchorInput && !anchorInput.value) {
      anchorInput.value = new Date().toISOString().split('T')[0];
    }

    // --- Main Dashboard Data Loader ---
    async function load() {
      const { stats: s } = await api.dashboardStats();

      // 1. Today's Sales
      const onlineDownpayment = s.sales_today.online_downpayment_centavos != null
        ? s.sales_today.online_downpayment_centavos
        : (s.sales_today.online_collected_centavos || 0);
      const walkinCollected = s.sales_today.walkin_gross_centavos || 0;
      const balanceCollected = s.sales_today.collected_balance_centavos || 0;
      const combinedTotal = s.sales_today.combined_centavos != null
        ? s.sales_today.combined_centavos
        : (onlineDownpayment + walkinCollected + balanceCollected);

      set('stat-combined', ui.pesos(combinedTotal));

      // 2. Awaiting Verification
      set('stat-pending', String(s.pending_verification || 0));

      // 3. Possible Collection (Remaining downpayment to collect)
      const possibleCollection = s.possible_collection_centavos != null
        ? s.possible_collection_centavos
        : (s.outstanding_balances_centavos || 0);
      set('stat-outstanding', ui.pesos(possibleCollection));

      // 4. Orders by Status
      const statusCounts = s.orders_by_status || {};
      const statusListEl = document.getElementById('status-breakdown');
      if (statusListEl) {
        statusListEl.innerHTML = ORDER_STATUS_CONFIG.map((cfg) => {
          const count = statusCounts[cfg.key] || 0;
          return `
            <div class="status-row">
              <span class="badge-status ${cfg.badgeClass}">${cfg.label}</span>
              <span class="status-count">${count}</span>
            </div>
          `;
        }).join('');
      }

      // 5. Low Stock Alerts
      // A. Products
      const products = s.low_stock || [];
      const prodTbody = document.getElementById('lowstock-products-tbody');
      if (prodTbody) {
        if (products.length === 0) {
          prodTbody.innerHTML = '<tr><td colspan="4" class="empty-state-cell">No low-stock products</td></tr>';
        } else {
          prodTbody.innerHTML = products.map((p) => {
            const isOut = Number(p.stock_pieces) <= 0;
            const badge = isOut
              ? '<span class="badge-status badge-status-red"><i class="fas fa-circle-xmark"></i> Out of Stock</span>'
              : '<span class="badge-status badge-status-amber"><i class="fas fa-triangle-exclamation"></i> Low Stock</span>';
            const bundles = p.bundles_available != null ? p.bundles_available : Math.floor(p.stock_pieces / (p.pieces_per_bundle || 1));
            return `
              <tr>
                <td><strong>${ui.esc(p.name)}</strong></td>
                <td>${p.stock_pieces} pcs <small class="text-muted">(${bundles} bdl)</small></td>
                <td>${p.low_stock_threshold_pieces} pcs</td>
                <td>${badge}</td>
              </tr>
            `;
          }).join('');
        }
      }

      // B. Ingredients
      const ingredients = s.low_stock_ingredients || [];
      const ingTbody = document.getElementById('lowstock-ingredients-tbody');
      if (ingTbody) {
        if (ingredients.length === 0) {
          ingTbody.innerHTML = '<tr><td colspan="4" class="empty-state-cell">No low-stock ingredients</td></tr>';
        } else {
          ingTbody.innerHTML = ingredients.map((ing) => {
            const isOut = ing.stock_status === 'out_of_stock' || Number(ing.stock_quantity) <= 0;
            const badge = isOut
              ? '<span class="badge-status badge-status-red"><i class="fas fa-circle-xmark"></i> Out of Stock</span>'
              : '<span class="badge-status badge-status-amber"><i class="fas fa-triangle-exclamation"></i> Low Stock</span>';
            const unit = ui.esc(ing.unit || 'pcs');
            return `
              <tr>
                <td><strong>${ui.esc(ing.name)}</strong></td>
                <td>${formatNumber(ing.stock_quantity)} ${unit}</td>
                <td>${formatNumber(ing.reorder_level)} ${unit}</td>
                <td>${badge}</td>
              </tr>
            `;
          }).join('');
        }
      }

      // 6. Recent Orders
      const recent = s.recent_orders || [];
      const recentTbody = document.getElementById('recent-tbody');
      if (recentTbody) {
        if (recent.length === 0) {
          recentTbody.innerHTML = '<tr><td colspan="5" class="empty-state-cell">No recent orders yet.</td></tr>';
        } else {
          recentTbody.innerHTML = recent.map((o) => `
            <tr>
              <td><a href="orders.html" class="order-id-link"><strong>${ui.esc(o.order_code)}</strong></a></td>
              <td><span class="truncate-cell" title="${ui.esc(o.customer_name)}">${ui.esc(o.customer_name)}</span></td>
              <td>${ui.pesos(o.total_centavos)}</td>
              <td>${renderStatusBadge(o.status)}</td>
              <td>${ui.fmtDate(o.created_at)}</td>
            </tr>
          `).join('');
        }
      }
    }

    // --- 7. Sales Report View & PDF Export ---
    async function viewReport() {
      const anchor = document.getElementById('report-anchor').value;
      if (!anchor) {
        if (ui.alert) {
          await ui.alert('Please select a date for the report.', 'Validation');
        } else {
          alert('Please select a date for the report.');
        }
        return;
      }

      const box = document.getElementById('report-summary');
      box.innerHTML = '<p class="muted"><i class="fas fa-spinner fa-spin"></i> Generating report preview…</p>';

      try {
        const { report: r } = await api.salesReport(
          document.getElementById('report-period').value,
          anchor
        );

        box.innerHTML = `
          <div class="report-line"><span>Report Period</span><strong>${ui.esc(r.label)}</strong></div>
          <div class="report-line"><span>Online Orders</span><strong>${r.online.orders} orders (${ui.pesos(r.online.gross_centavos)})</strong></div>
          <div class="report-line"><span>Walk-in Sales</span><strong>${r.walkin.sales} sales (${ui.pesos(r.walkin.gross_centavos)})</strong></div>
          <div class="report-line"><span>Combined Gross</span><strong>${ui.pesos(r.combined_gross_centavos)}</strong></div>
          <div class="report-line"><span>Actual Collected</span><strong>${ui.pesos(r.collected_centavos)}</strong></div>
          <div class="report-line"><span>Refunds Deducted</span><strong>${ui.pesos(r.refunded.total_centavos)} (${r.refunded.count})</strong></div>
          <div class="report-line total"><span>Net Revenue</span><strong>${ui.pesos(r.net_collected_centavos)}</strong></div>
        `;
      } catch (err) {
        box.innerHTML = `<p class="error-text"><i class="fas fa-exclamation-circle"></i> ${ui.esc(err.message)}</p>`;
      }
    }

    async function exportPdf() {
      const anchor = document.getElementById('report-anchor').value;
      if (!anchor) {
        if (ui.alert) {
          await ui.alert('Please select a date for the PDF report.', 'Validation');
        } else {
          alert('Please select a date for the PDF report.');
        }
        return;
      }

      const btn = document.getElementById('btn-report-pdf');
      btn.disabled = true;
      const origHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating PDF…';

      try {
        const { blob, filename } = await api.salesPdf(
          document.getElementById('report-period').value,
          anchor
        );
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch (err) {
        if (ui.alert) {
          await ui.alert(err.message || 'PDF export failed.', 'Export Error');
        } else {
          alert(err.message || 'PDF export failed.');
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }

    const btnView = document.getElementById('btn-report-view');
    if (btnView) btnView.addEventListener('click', viewReport);

    const btnPdf = document.getElementById('btn-report-pdf');
    if (btnPdf) btnPdf.addEventListener('click', exportPdf);

    // Initial load
    load().catch((err) => {
      console.error('Dashboard load error:', err);
      const recentTbody = document.getElementById('recent-tbody');
      if (recentTbody) {
        recentTbody.innerHTML = `<tr><td colspan="5" class="error-text"><i class="fas fa-exclamation-triangle"></i> Failed to load dashboard: ${ui.esc(err.message)}</td></tr>`;
      }
    });
  });
})();
