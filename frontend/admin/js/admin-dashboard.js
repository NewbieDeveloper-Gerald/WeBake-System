/**
 * admin-dashboard.js — WeBake Admin Dashboard
 *
 * Implements the required dashboard sections:
 * 1. Summary Cards (Today's Sales, Awaiting Verification, Possible Collection, Refund Requests)
 * 2. Orders by Status & Needs Attention (Recent pending refund requests)
 * 3. Stock Alerts (Unified Products & Ingredients with Out-of-Stock priority, tabs, and auto-refresh)
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

    let lastLoadedAt = null;
    let activeAlertTab = null;
    let isFetching = false;
    let refreshTimer = null;
    let timeAgoInterval = null;

    function formatNumber(num) {
      if (num == null || isNaN(num)) return '0';
      const n = Number(num);
      return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    }

    function formatTimeAgo(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      if (isNaN(date.getTime())) return '';
      const now = new Date();
      const diffSecs = Math.max(0, Math.floor((now - date) / 1000));
      if (diffSecs < 60) return 'just now';
      const diffMins = Math.floor(diffSecs / 60);
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
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

    function updateTimestampText() {
      const tsEl = document.getElementById('alerts-timestamp');
      if (!tsEl || !lastLoadedAt) return;
      const secs = Math.floor((Date.now() - lastLoadedAt) / 1000);
      if (secs < 20) {
        tsEl.textContent = 'Updated just now';
      } else if (secs < 60) {
        tsEl.textContent = 'Updated ' + secs + 's ago';
      } else {
        const mins = Math.floor(secs / 60);
        tsEl.textContent = 'Updated ' + mins + 'm ago';
      }
    }

    // Set default date for report anchor
    const anchorInput = document.getElementById('report-anchor');
    if (anchorInput && !anchorInput.value) {
      anchorInput.value = new Date().toISOString().split('T')[0];
    }

    // --- Tab Switching Logic ---
    function setupStockAlertTabs() {
      const tabBtns = document.querySelectorAll('.stock-tab-btn');
      tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          switchAlertTab(btn.dataset.tab);
        });
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const target = btn.dataset.tab === 'products' ? 'ingredients' : 'products';
            switchAlertTab(target);
            const targetBtn = document.getElementById(`tab-btn-${target}`);
            if (targetBtn) targetBtn.focus();
          }
        });
      });
    }

    function switchAlertTab(tabName) {
      activeAlertTab = tabName;
      document.querySelectorAll('.stock-tab-btn').forEach((b) => {
        const isMatch = b.dataset.tab === tabName;
        b.classList.toggle('active', isMatch);
        b.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      const prodPanel = document.getElementById('panel-alert-products');
      const ingPanel = document.getElementById('panel-alert-ingredients');
      if (prodPanel) prodPanel.style.display = tabName === 'products' ? 'block' : 'none';
      if (ingPanel) ingPanel.style.display = tabName === 'ingredients' ? 'block' : 'none';
    }

    // --- Stock Alerts Rendering ---
    function renderStockAlerts(alertsData, fallbackProducts, fallbackIngredients) {
      const alerts = alertsData || {
        products: (fallbackProducts || []).map((p) => ({
          id: p.id,
          name: p.name,
          quantity: Number(p.stock_pieces) || 0,
          reorder_level: Number(p.low_stock_threshold_pieces) || 0,
          unit: 'pcs',
          bundles_available: p.bundles_available != null ? p.bundles_available : Math.floor(p.stock_pieces / (p.pieces_per_bundle || 1)),
          severity: Number(p.stock_pieces) <= 0 ? 'out_of_stock' : 'low_stock',
        })),
        ingredients: (fallbackIngredients || []).map((i) => ({
          id: i.id,
          name: i.name,
          quantity: Number(i.stock_quantity) || 0,
          reorder_level: Number(i.reorder_level) || 0,
          unit: i.unit || 'kg',
          severity: (i.stock_status === 'out_of_stock' || Number(i.stock_quantity) <= 0) ? 'out_of_stock' : 'low_stock',
        })),
        summary: null,
      };

      const products = alerts.products || [];
      const ingredients = alerts.ingredients || [];

      // Summary counts
      const prodOut = products.filter((p) => p.severity === 'out_of_stock').length;
      const prodLow = products.filter((p) => p.severity === 'low_stock').length;
      const ingOut = ingredients.filter((i) => i.severity === 'out_of_stock').length;
      const ingLow = ingredients.filter((i) => i.severity === 'low_stock').length;
      const totalOut = prodOut + ingOut;
      const totalLow = prodLow + ingLow;

      // 1. Update Tab Badges
      set('badge-products-alerts', String(products.length));
      set('badge-ingredients-alerts', String(ingredients.length));

      // 2. Select default tab if not yet picked: prioritize tab with most severe alerts
      if (!activeAlertTab) {
        if (alerts.summary && alerts.summary.most_severe) {
          activeAlertTab = alerts.summary.most_severe;
        } else if (ingOut > prodOut) {
          activeAlertTab = 'ingredients';
        } else if (ingOut === prodOut && ingLow > prodLow) {
          activeAlertTab = 'ingredients';
        } else {
          activeAlertTab = 'products';
        }
      }
      switchAlertTab(activeAlertTab);

      // 3. Summary Strip
      const summaryStripText = document.getElementById('alerts-summary-text');
      const summaryStripPills = document.getElementById('alerts-summary-pills');
      if (summaryStripText && summaryStripPills) {
        if (totalOut === 0 && totalLow === 0) {
          summaryStripText.textContent = 'All inventory levels healthy.';
          summaryStripPills.innerHTML = '<span class="alert-pill alert-pill--ok"><i class="fas fa-circle-check"></i> Stock OK</span>';
        } else {
          summaryStripText.textContent = `${totalOut + totalLow} total item${(totalOut + totalLow) === 1 ? '' : 's'} require reorder:`;
          summaryStripPills.innerHTML = `
            ${totalOut > 0 ? `<span class="alert-pill alert-pill--out"><i class="fas fa-circle-xmark"></i> ${totalOut} Out of Stock</span>` : ''}
            ${totalLow > 0 ? `<span class="alert-pill alert-pill--low"><i class="fas fa-triangle-exclamation"></i> ${totalLow} Low Stock</span>` : ''}
          `;
        }
      }

      // 4. Render Products Panel (Top 5, Out of Stock first)
      const prodTbody = document.getElementById('lowstock-products-tbody');
      const prodFooter = document.getElementById('footer-alert-products');
      if (prodTbody) {
        if (products.length === 0) {
          prodTbody.innerHTML = `
            <tr>
              <td colspan="5" style="padding:0; border:none;">
                <div class="empty-healthy-state">
                  <i class="fas fa-circle-check"></i>
                  <strong>All products in stock</strong>
                  <span>No products are depleted or below reorder threshold.</span>
                </div>
              </td>
            </tr>
          `;
          if (prodFooter) prodFooter.style.display = 'none';
        } else {
          // Sort: out of stock first, then lowest ratio
          const sortedProducts = [...products].sort((a, b) => {
            const aOut = a.severity === 'out_of_stock' ? 1 : 0;
            const bOut = b.severity === 'out_of_stock' ? 1 : 0;
            if (aOut !== bOut) return bOut - aOut;
            return (a.ratio || 0) - (b.ratio || 0);
          });

          const top5Products = sortedProducts.slice(0, 5);
          prodTbody.innerHTML = top5Products.map((p) => {
            const isOut = p.severity === 'out_of_stock' || Number(p.quantity) <= 0;
            const badge = isOut
              ? '<span class="badge-status badge-status-red" aria-label="Status: Out of Stock"><i class="fas fa-circle-xmark"></i> Out of Stock</span>'
              : '<span class="badge-status badge-status-amber" aria-label="Status: Low Stock"><i class="fas fa-triangle-exclamation"></i> Low Stock</span>';
            const bundlesText = p.bundles_available != null ? `<small class="text-muted">(${p.bundles_available} bdl)</small>` : '';

            return `
              <tr class="alert-row-clickable" onclick="location.href='products.html?filter=${isOut ? 'out_of_stock' : 'low_stock'}'" title="View in Product Inventory">
                <td><strong>${ui.esc(p.name)}</strong></td>
                <td><strong>${p.quantity} pcs</strong> ${bundlesText}</td>
                <td>${p.reorder_level} pcs</td>
                <td>${badge}</td>
                <td style="text-align:right;">
                  <a href="products.html?filter=${isOut ? 'out_of_stock' : 'low_stock'}" class="btn btn-outline btn-sm" onclick="event.stopPropagation();" title="Manage product in catalog">View</a>
                </td>
              </tr>
            `;
          }).join('');

          if (prodFooter) {
            prodFooter.style.display = 'flex';
            const link = document.getElementById('link-view-all-products');
            if (link) {
              const filterParam = prodOut > 0 ? 'out_of_stock' : 'low_stock';
              link.href = `products.html?filter=${filterParam}`;
              link.innerHTML = `View all (${products.length}) products in catalog &rarr;`;
            }
          }
        }
      }

      // 5. Render Ingredients Panel (Top 5, Out of Stock first)
      const ingTbody = document.getElementById('lowstock-ingredients-tbody');
      const ingFooter = document.getElementById('footer-alert-ingredients');
      if (ingTbody) {
        if (ingredients.length === 0) {
          ingTbody.innerHTML = `
            <tr>
              <td colspan="5" style="padding:0; border:none;">
                <div class="empty-healthy-state">
                  <i class="fas fa-circle-check"></i>
                  <strong>All ingredients healthy</strong>
                  <span>Raw bakery supplies and ingredients are sufficiently stocked.</span>
                </div>
              </td>
            </tr>
          `;
          if (ingFooter) ingFooter.style.display = 'none';
        } else {
          // Sort: out of stock first, then lowest ratio
          const sortedIngredients = [...ingredients].sort((a, b) => {
            const aOut = a.severity === 'out_of_stock' ? 1 : 0;
            const bOut = b.severity === 'out_of_stock' ? 1 : 0;
            if (aOut !== bOut) return bOut - aOut;
            return (a.ratio || 0) - (b.ratio || 0);
          });

          const top5Ingredients = sortedIngredients.slice(0, 5);
          ingTbody.innerHTML = top5Ingredients.map((ing) => {
            const isOut = ing.severity === 'out_of_stock' || Number(ing.quantity) <= 0;
            const badge = isOut
              ? '<span class="badge-status badge-status-red" aria-label="Status: Out of Stock"><i class="fas fa-circle-xmark"></i> Out of Stock</span>'
              : '<span class="badge-status badge-status-amber" aria-label="Status: Low Stock"><i class="fas fa-triangle-exclamation"></i> Low Stock</span>';
            const unit = ui.esc(ing.unit || 'kg');

            return `
              <tr class="alert-row-clickable" onclick="location.href='ingredients.html?filter=${isOut ? 'out_of_stock' : 'low_stock'}'" title="View in Ingredients">
                <td><strong>${ui.esc(ing.name)}</strong></td>
                <td><strong>${formatNumber(ing.quantity)} ${unit}</strong></td>
                <td>${formatNumber(ing.reorder_level)} ${unit}</td>
                <td>${badge}</td>
                <td style="text-align:right;">
                  <a href="ingredients.html?filter=${isOut ? 'out_of_stock' : 'low_stock'}" class="btn btn-outline btn-sm" onclick="event.stopPropagation();" title="Restock or edit ingredient">Restock</a>
                </td>
              </tr>
            `;
          }).join('');

          if (ingFooter) {
            ingFooter.style.display = 'flex';
            const link = document.getElementById('link-view-all-ingredients');
            if (link) {
              const filterParam = ingOut > 0 ? 'out_of_stock' : 'low_stock';
              link.href = `ingredients.html?filter=${filterParam}`;
              link.innerHTML = `View all (${ingredients.length}) ingredients in inventory &rarr;`;
            }
          }
        }
      }
    }

    // --- Main Dashboard Data Loader ---
    async function load() {
      if (isFetching) return;
      isFetching = true;

      const refreshBtn = document.getElementById('btn-refresh-dashboard');
      if (refreshBtn) refreshBtn.classList.add('is-spinning');

      try {
        const { stats: s } = await api.dashboardStats();
        lastLoadedAt = Date.now();
        updateTimestampText();

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
        const pendingVerificationCount = s.pending_verification || 0;
        set('stat-pending', String(pendingVerificationCount));

        // 3. Possible Collection (Remaining downpayment to collect)
        const possibleCollection = s.possible_collection_centavos != null
          ? s.possible_collection_centavos
          : (s.outstanding_balances_centavos || 0);
        set('stat-outstanding', ui.pesos(possibleCollection));

        // 4. Refund Requests Card
        const refundObj = s.refunds || {};
        const pendingRefunds = Number(refundObj.pending_count != null ? refundObj.pending_count : (refundObj.alert_count || 0));
        const pendingRefundsAmount = Number(refundObj.pending_amount_centavos || 0);
        const oldestRequestedAt = refundObj.oldest_pending_requested_at || null;

        const refundCard = document.getElementById('stat-card-refunds');
        const refundPendingEl = document.getElementById('stat-refunds-pending');
        const refundSubEl = document.getElementById('stat-refunds-sub');
        const refundOldestEl = document.getElementById('stat-refunds-oldest');

        if (refundPendingEl) refundPendingEl.textContent = String(pendingRefunds);
        if (refundCard) {
          refundCard.classList.toggle('has-pending', pendingRefunds > 0);
          refundCard.classList.toggle('no-pending', pendingRefunds === 0);
          refundCard.setAttribute(
            'aria-label',
            pendingRefunds > 0
              ? `${pendingRefunds} refund requests awaiting review totaling ${ui.pesos(pendingRefundsAmount)}`
              : 'No pending refund requests'
          );
        }
        if (refundSubEl) {
          refundSubEl.textContent = pendingRefunds > 0
            ? `awaiting review · ${ui.pesos(pendingRefundsAmount)} pending`
            : 'No pending refunds';
        }
        if (refundOldestEl) {
          refundOldestEl.textContent = (pendingRefunds > 0 && oldestRequestedAt)
            ? `Oldest: ${formatTimeAgo(oldestRequestedAt)}`
            : '';
        }

        // Keep sidebar badges 100% in sync with live dashboard counts
        if (window.CRBAdminSidebar && typeof window.CRBAdminSidebar.setBadge === 'function') {
          window.CRBAdminSidebar.setBadge('refunds', pendingRefunds);
          window.CRBAdminSidebar.setBadge('orders', pendingVerificationCount);
        }

        // 5. Orders by Status & Needs Attention (Recent pending refunds)
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

        const needsAttentionWrap = document.getElementById('needs-attention-refunds');
        const needsAttentionList = document.getElementById('needs-attention-refunds-list');
        if (needsAttentionWrap && needsAttentionList) {
          const recentPending = refundObj.recent_pending || [];
          if (recentPending.length > 0) {
            needsAttentionWrap.style.display = 'block';
            needsAttentionList.innerHTML = recentPending.map((r) => `
              <div class="needs-attention-item">
                <div>
                  <strong>${ui.esc(r.customer_name || 'Customer')}</strong>
                  <small class="text-muted">(${ui.esc(r.order_code)})</small>
                </div>
                <div>
                  <span style="font-weight:700; color:#B91C1C;">${ui.pesos(r.refund_amount_centavos)}</span>
                  <small class="text-muted" style="margin-left:4px;">${formatTimeAgo(r.requested_at)}</small>
                </div>
              </div>
            `).join('');
          } else {
            needsAttentionWrap.style.display = 'none';
          }
        }

        // 6. Stock Alerts (Unified Products & Ingredients)
        renderStockAlerts(s.alerts, s.low_stock, s.low_stock_ingredients);

        // 7. Recent Orders
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
      } catch (err) {
        console.error('Dashboard load error:', err);
        const alertStrip = document.getElementById('alerts-summary-text');
        if (alertStrip) {
          alertStrip.innerHTML = `<span class="error-text"><i class="fas fa-triangle-exclamation"></i> Error loading live stock alerts: ${ui.esc(err.message)}</span>`;
        }
      } finally {
        isFetching = false;
        if (refreshBtn) refreshBtn.classList.remove('is-spinning');
      }
    }

    // --- 8. Sales Report View & PDF Export ---
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

    // Setup tabs
    setupStockAlertTabs();

    // Manual Refresh button
    const refreshBtn = document.getElementById('btn-refresh-dashboard');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        load();
      });
    }

    // Auto-refresh: 60-second polling interval
    refreshTimer = setInterval(load, 60000);

    // Update relative timestamp every 15 seconds
    timeAgoInterval = setInterval(updateTimestampText, 15000);

    // Refresh when browser tab regains focus or becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        load();
      }
    });

    window.addEventListener('focus', () => {
      load();
    });

    // Initial load
    load();
  });
})();
