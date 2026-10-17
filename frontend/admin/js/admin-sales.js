/**
 * WeBake Admin Portal — Sales & Revenue Controller (admin-sales.js)
 * Clean, senior-grade implementation:
 * - Single source of truth driven by single global period toolbar
 * - Unified metrics: Booked Sales, Cash Collected, Outstanding Balance, Refunds, Net Revenue
 * - Themed Chart.js trends, channel donut, and top 5 products
 * - Tabbed breakdown: By Product (with tfoot totals & progress bars), Transactions, Payments
 * - Search, sortable tables, pagination, and multi-format exports (PDF, CSVs)
 * - Auto-refresh (60s), tab focus detection, relative timestamps, and live sidebar badge sync
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const ui = window.AdminUI || {};
    const api = window.AdminAPI || {};

    if (!document.getElementById('period-human-label')) return;

    // --- State ---
    let currentPeriod = 'today';
    let customFrom = '';
    let customTo = '';
    let cachedReport = null;
    let activeTab = 'tab-by-product';

    let productSort = { col: 'total_centavos', dir: 'desc' };

    let paySearch = '';
    let payPage = 1;
    const payPageSize = 10;

    // State for Record Payment modal
    let cachedUnpaidCustomers = [];
    let selectedCustomerOrders = [];
    let selectedOrder = null;

    let lastUpdated = new Date();
    let isFetching = false;
    let autoRefreshTimer = null;
    let timeAgoTimer = null;

    let trendChartInstance = null;
    let donutChartInstance = null;

    // Manila today helper
    function getManilaToday() {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    }

    // Money formatter (₱ with tabular numbers)
    function formatPesos(centavos) {
      const c = Number(centavos) || 0;
      return '₱' + (c / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    function formatNumber(n) {
      return (Number(n) || 0).toLocaleString('en-US');
    }

    function esc(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Relative timestamp formatter
    function timeAgo(date) {
      const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
      if (diffSec < 10) return 'Updated just now';
      if (diffSec < 60) return `Updated ${diffSec}s ago`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin === 1) return 'Updated 1 min ago';
      if (diffMin < 60) return `Updated ${diffMin} min ago`;
      const diffHr = Math.floor(diffMin / 60);
      return `Updated ${diffHr} hr ago`;
    }

    function updateTimestampText() {
      const el = document.getElementById('sales-timestamp-text');
      if (el) el.textContent = timeAgo(lastUpdated);
    }

    // --- Toast Feedback ---
    function showToast(message, type = 'info') {
      const container = document.getElementById('sales-toast-container');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = `sales-toast is-${type}`;
      const icon = type === 'success' ? 'fa-check-circle' : (type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle');
      toast.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i> <span>${esc(message)}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 250);
      }, 3500);
    }

    // --- URL State Management ---
    function readUrlParams() {
      try {
        const params = new URLSearchParams(window.location.search);
        const p = params.get('period');
        if (p && ['today', 'weekly', 'monthly', 'custom', 'yesterday', 'last7days'].includes(p)) {
          currentPeriod = p;
        }
        const f = params.get('from');
        const t = params.get('to');
        if (f) customFrom = f;
        if (t) customTo = t;
      } catch (_) {}
    }

    function syncUrlParams() {
      try {
        const params = new URLSearchParams();
        params.set('period', currentPeriod);
        if (currentPeriod === 'custom') {
          if (customFrom) params.set('from', customFrom);
          if (customTo) params.set('to', customTo);
        }
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newUrl);
      } catch (_) {}
    }

    // --- Toolbar & Custom Range UI ---
    function initToolbar() {
      const periodButtons = document.querySelectorAll('.segment-btn');
      const customCard = document.getElementById('custom-range-card');
      const startDateInput = document.getElementById('custom-date-start');
      const endDateInput = document.getElementById('custom-date-end');
      const applyCustomBtn = document.getElementById('btn-apply-custom-range');
      const presetButtons = document.querySelectorAll('.preset-pill');

      const today = getManilaToday();
      if (startDateInput && !startDateInput.value) startDateInput.value = customFrom || today;
      if (endDateInput && !endDateInput.value) endDateInput.value = customTo || today;

      // Highlight active button
      periodButtons.forEach((btn) => {
        if (btn.getAttribute('data-period') === currentPeriod) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }

        btn.addEventListener('click', () => {
          const targetPeriod = btn.getAttribute('data-period');
          periodButtons.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          currentPeriod = targetPeriod;

          if (targetPeriod === 'custom') {
            if (customCard) customCard.classList.add('is-open');
          } else {
            if (customCard) customCard.classList.remove('is-open');
            syncUrlParams();
            loadSalesData();
          }
        });
      });

      if (currentPeriod === 'custom' && customCard) {
        customCard.classList.add('is-open');
      }

      // Presets
      presetButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-preset');
          const now = new Date();
          const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);

          if (preset === 'yesterday') {
            const y = new Date();
            y.setDate(y.getDate() - 1);
            if (startDateInput) startDateInput.value = fmt(y);
            if (endDateInput) endDateInput.value = fmt(y);
          } else if (preset === 'last7days') {
            const start = new Date();
            start.setDate(start.getDate() - 6);
            if (startDateInput) startDateInput.value = fmt(start);
            if (endDateInput) endDateInput.value = fmt(now);
          } else if (preset === 'last30days') {
            const start = new Date();
            start.setDate(start.getDate() - 29);
            if (startDateInput) startDateInput.value = fmt(start);
            if (endDateInput) endDateInput.value = fmt(now);
          }
          if (applyCustomBtn) applyCustomBtn.click();
        });
      });

      if (applyCustomBtn) {
        applyCustomBtn.addEventListener('click', () => {
          customFrom = startDateInput ? startDateInput.value : '';
          customTo = endDateInput ? endDateInput.value : '';
          if (!customFrom || !customTo) {
            showToast('Please select both start and end dates.', 'error');
            return;
          }
          currentPeriod = 'custom';
          syncUrlParams();
          loadSalesData();
        });
      }

      // Manual refresh button
      const refreshBtn = document.getElementById('btn-refresh-sales');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          loadSalesData(true);
        });
      }
    }

    // --- Export Dropdown Handling ---
    function initExportDropdown() {
      const dropdownWrap = document.getElementById('export-dropdown-wrap');
      const toggleBtn = document.getElementById('btn-export-dropdown');
      const menu = document.getElementById('export-menu');
      const btnPdf = document.getElementById('btn-export-pdf');
      const btnCsvPay = document.getElementById('btn-export-csv-payments');
      const btnCsvProd = document.getElementById('btn-export-csv-products');

      if (!toggleBtn || !menu) return;

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('is-open');
        if (isOpen) {
          menu.classList.remove('is-open');
          toggleBtn.setAttribute('aria-expanded', 'false');
        } else {
          menu.classList.add('is-open');
          toggleBtn.setAttribute('aria-expanded', 'true');
        }
      });

      document.addEventListener('click', (e) => {
        if (!dropdownWrap || !dropdownWrap.contains(e.target)) {
          menu.classList.remove('is-open');
          toggleBtn.setAttribute('aria-expanded', 'false');
        }
      });

      // PDF Export
      if (btnPdf) {
        btnPdf.addEventListener('click', async () => {
          menu.classList.remove('is-open');
          toggleBtn.disabled = true;
          toggleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating PDF…';
          try {
            const queryParams = {
              period: currentPeriod,
              from: currentPeriod === 'custom' ? customFrom : undefined,
              to: currentPeriod === 'custom' ? customTo : undefined,
            };
            const { blob, filename } = await api.salesPdf(queryParams);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || `webake-sales-${currentPeriod}-${getManilaToday()}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            showToast('PDF report downloaded successfully.', 'success');
          } catch (err) {
            console.error('PDF export failed:', err);
            showToast('Failed to export PDF: ' + err.message, 'error');
          } finally {
            toggleBtn.disabled = false;
            toggleBtn.innerHTML = '<i class="fas fa-download"></i> Export <i class="fas fa-chevron-down" style="font-size:0.7rem; margin-left:4px;"></i>';
          }
        });
      }

      // CSV Payments Export
      if (btnCsvPay) {
        btnCsvPay.addEventListener('click', () => {
          menu.classList.remove('is-open');
          if (!cachedReport || !cachedReport.payments || cachedReport.payments.length === 0) {
            showToast('No payments to export for this period.', 'info');
            return;
          }
          try {
            exportPaymentsCsv(cachedReport.payments, cachedReport.label);
            showToast('Payments CSV exported.', 'success');
          } catch (err) {
            showToast('CSV export failed: ' + err.message, 'error');
          }
        });
      }

      // CSV By Product Export
      if (btnCsvProd) {
        btnCsvProd.addEventListener('click', () => {
          menu.classList.remove('is-open');
          if (!cachedReport || !cachedReport.by_product || cachedReport.by_product.length === 0) {
            showToast('No product sales to export for this period.', 'info');
            return;
          }
          try {
            exportProductsCsv(cachedReport.by_product, cachedReport.label);
            showToast('By Product CSV exported.', 'success');
          } catch (err) {
            showToast('CSV export failed: ' + err.message, 'error');
          }
        });
      }
    }

    // --- CSV Download Helpers ---
    function triggerCsvDownload(csvContent, filename) {
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function exportPaymentsCsv(payments, periodLabel) {
      const headers = ['Date', 'Time (Manila)', 'Order Code', 'Customer', 'Payment Stage', 'Method', 'Reference No.', 'Amount Received (PHP)', 'Recorded By', 'Notes', 'Status'];
      const rows = payments.map((p) => {
        const d = new Date(p.created_at);
        const dateStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila' });
        const timeStr = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' });
        return [
          `"${dateStr}"`,
          `"${timeStr}"`,
          `"${p.order_code || ''}"`,
          `"${(p.customer_name || '').replace(/"/g, '""')}"`,
          `"${p.stage || ''}"`,
          `"${p.channel || ''}"`,
          `"${p.reference_number || ''}"`,
          (p.amount_centavos / 100).toFixed(2),
          `"${(p.recorded_by || '').replace(/"/g, '""')}"`,
          `"${(p.notes || '').replace(/"/g, '""')}"`,
          p.is_voided ? '"VOIDED"' : '"ACTIVE"',
        ].join(',');
      });
      const csv = [headers.join(','), ...rows].join('\r\n');
      const filename = `webake-payments-${currentPeriod}-${getManilaToday()}.csv`;
      triggerCsvDownload(csv, filename);
    }

    function exportProductsCsv(byProduct, periodLabel) {
      const headers = ['Product Name', 'Bundles Sold', 'Pieces Sold', 'Online Bundles', 'Walk-in Bundles', 'Walk-in Pieces', 'Total Sales (PHP)', 'Share of Sales (%)'];
      const rows = byProduct.map((p) => [
        `"${(p.product_name || '').replace(/"/g, '""')}"`,
        p.bundles_sold,
        p.pieces_sold,
        p.online_bundles,
        p.walkin_bundles,
        p.walkin_pieces,
        (p.total_centavos / 100).toFixed(2),
        p.share_pct != null ? p.share_pct : '0.0',
      ].join(','));
      const csv = [headers.join(','), ...rows].join('\r\n');
      const filename = `webake-sales-by-product-${currentPeriod}-${getManilaToday()}.csv`;
      triggerCsvDownload(csv, filename);
    }

    // --- Main Data Fetcher ---
    async function loadSalesData(isManual = false) {
      if (isFetching) return;
      isFetching = true;

      const refreshBtn = document.getElementById('btn-refresh-sales');
      if (refreshBtn) refreshBtn.classList.add('is-spinning');

      try {
        const queryParams = {
          period: currentPeriod,
          from: currentPeriod === 'custom' ? customFrom : undefined,
          to: currentPeriod === 'custom' ? customTo : undefined,
        };

        const res = await api.salesReport(queryParams);
        const report = res.report || {};
        cachedReport = report;
        lastUpdated = new Date();
        updateTimestampText();

        // 1. Period Header & Label
        const rangeTextEl = document.getElementById('period-human-text');
        if (rangeTextEl) rangeTextEl.textContent = report.label || 'Selected Period';

        // 2. Render 4 Summary Cards
        renderKpiCards(report);

        // 3. Update Sidebar Badges dynamically
        if (window.CRBAdminSidebar && typeof window.CRBAdminSidebar.setBadge === 'function') {
          api.dashboardStats().then((res) => {
            if (res && res.stats) {
              const pendingVerification = res.stats.pending_verification || 0;
              const refundObj = res.stats.refunds || {};
              const pendingRefunds = (refundObj.pending_count || 0) + (refundObj.awaiting_count || 0);
              window.CRBAdminSidebar.setBadge('orders', pendingVerification);
              window.CRBAdminSidebar.setBadge('refunds', pendingRefunds);
            }
          }).catch(() => {});
        }

        // 4. Render Charts
        renderCharts(report);

        // 5. Render Tables
        renderPartnerPaymentsTable(report);
        renderByProductTable(report);
        renderPaymentsTable(report);

        if (isManual) {
          showToast('Sales data updated.', 'success');
        }
      } catch (err) {
        console.error('Failed to load sales data:', err);
        showToast('Error loading sales data: ' + err.message, 'error');
        const tbody = document.getElementById('sales-by-product-tbody');
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger" style="padding:2rem;"><i class="fas fa-triangle-exclamation"></i> Failed to load report: ${esc(err.message)}</td></tr>`;
        }
      } finally {
        isFetching = false;
        if (refreshBtn) refreshBtn.classList.remove('is-spinning');
      }
    }

    // --- Render 4 Summary Cards ---
    function renderKpiCards(r) {
      const m = r.metrics || {};

      // Card 1: Net Sales (Hero)
      const netValEl = document.getElementById('kpi-net-revenue');
      const netSubEl = document.getElementById('kpi-net-revenue-sub');
      if (netValEl) netValEl.textContent = formatPesos(m.net_revenue_centavos);
      if (netSubEl) {
        const refCentavos = m.refunds_centavos || 0;
        netSubEl.textContent = refCentavos > 0
          ? `${formatPesos(refCentavos)} refunded`
          : '₱0.00 refunded';
      }

      // Card 2: Cash Collected
      const cashValEl = document.getElementById('kpi-cash-collected');
      const cashSubEl = document.getElementById('kpi-cash-collected-sub');
      if (cashValEl) cashValEl.textContent = formatPesos(m.cash_collected_centavos);
      if (cashSubEl) cashSubEl.textContent = `${formatNumber(m.payments_count || 0)} payment(s) received`;

      // Card 3: Unpaid Balance
      const outValEl = document.getElementById('kpi-outstanding-balance');
      const outSubEl = document.getElementById('kpi-outstanding-sub');
      const outBal = m.outstanding_balance_centavos || 0;
      const ordersWithBal = m.orders_with_balance || 0;
      if (outValEl) outValEl.textContent = formatPesos(outBal);
      if (outSubEl) {
        outSubEl.textContent = ordersWithBal > 0
          ? `${formatNumber(ordersWithBal)} order(s) with balance`
          : 'All orders paid in full';
      }

      // Card 4: Refunds
      const refValEl = document.getElementById('kpi-refunds');
      const refSubEl = document.getElementById('kpi-refunds-sub');
      const refCentavos = m.refunds_centavos || 0;
      if (refValEl) refValEl.textContent = formatPesos(refCentavos);
      if (refSubEl) {
        const refCount = m.refunds_count || 0;
        refSubEl.textContent = refCount > 0
          ? `${formatNumber(refCount)} approved refund(s)`
          : 'No refunds this period';
      }
    }

    // Dynamic fallback loader for Chart.js across local and CDN sources
    function ensureChartJs(callback) {
      if (typeof Chart !== 'undefined') {
        if (callback) callback();
        return;
      }
      if (window._chartJsLoading) {
        window._chartJsWaiters = window._chartJsWaiters || [];
        if (callback) window._chartJsWaiters.push(callback);
        return;
      }
      window._chartJsLoading = true;
      window._chartJsWaiters = callback ? [callback] : [];

      function fireAll() {
        window._chartJsLoading = false;
        const list = window._chartJsWaiters || [];
        window._chartJsWaiters = [];
        list.forEach((fn) => {
          try { fn(); } catch (_) {}
        });
      }

      const sources = [
        '../js/vendor/chart.umd.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
      ];

      function trySource(idx) {
        if (idx >= sources.length) {
          console.warn('Chart.js could not be loaded from any source');
          window._chartJsLoading = false;
          return;
        }
        const s = document.createElement('script');
        s.src = sources[idx];
        s.onload = () => {
          if (typeof Chart !== 'undefined') {
            fireAll();
          } else {
            trySource(idx + 1);
          }
        };
        s.onerror = () => trySource(idx + 1);
        document.head.appendChild(s);
      }

      trySource(0);
    }

    // --- Render Charts with Chart.js ---
    function renderCharts(r) {
      const chartsData = r.charts || {};
      const trendData = chartsData.trend || [];
      const channelData = chartsData.channel_split || { online_centavos: 0, walkin_centavos: 0, online_pct: 0, walkin_pct: 0 };
      const topProducts = chartsData.top_products || [];

      // Render Top Products Widget (pure HTML/CSS, independent of Chart.js)
      renderTopProductsWidget(topProducts);

      if (typeof Chart === 'undefined') {
        ensureChartJs(() => {
          if (cachedReport) renderCharts(cachedReport);
        });
        return;
      }

      // 1. Trend Chart
      const trendCanvas = document.getElementById('chart-revenue-trend-canvas');
      const trendEmpty = document.getElementById('chart-trend-empty');
      const hasTrendData = trendData.some((b) => (b.online_centavos > 0 || b.walkin_centavos > 0 || (b.partner_centavos || 0) > 0));

      if (trendChartInstance) {
        trendChartInstance.destroy();
        trendChartInstance = null;
      }

      if (!hasTrendData) {
        if (trendCanvas) trendCanvas.style.display = 'none';
        if (trendEmpty) trendEmpty.style.display = 'flex';
      } else {
        if (trendCanvas) trendCanvas.style.display = 'block';
        if (trendEmpty) trendEmpty.style.display = 'none';

        const labels = trendData.map((b) => b.label);
        const onlineSeries = trendData.map((b) => (b.online_centavos || 0) / 100);
        const walkinSeries = trendData.map((b) => (b.walkin_centavos || 0) / 100);
        const partnerSeries = trendData.map((b) => (b.partner_centavos || 0) / 100);

        trendChartInstance = new Chart(trendCanvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              {
                label: 'Online Collections',
                data: onlineSeries,
                backgroundColor: '#C48B3F',
                borderRadius: 4,
                stack: 'stack0',
              },
              {
                label: 'Walk-In Cash',
                data: walkinSeries,
                backgroundColor: '#2D6A4F',
                borderRadius: 4,
                stack: 'stack0',
              },
              {
                label: 'Partner Payments',
                data: partnerSeries,
                backgroundColor: '#D97706',
                borderRadius: 4,
                stack: 'stack0',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  boxWidth: 12,
                  font: { size: 11, family: 'system-ui, sans-serif' },
                  color: '#3E241B',
                },
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => ` ${ctx.dataset.label}: ₱${ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                },
              },
            },
            scales: {
              x: {
                stacked: true,
                grid: { display: false },
                ticks: { color: '#7A685D', font: { size: 10 } },
              },
              y: {
                stacked: true,
                grid: { color: '#F0E6DD' },
                ticks: {
                  color: '#7A685D',
                  font: { size: 10 },
                  callback: (val) => `₱${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}`,
                },
              },
            },
          },
        });
      }

      // 2. Channel Donut Chart
      const donutCanvas = document.getElementById('chart-channel-donut-canvas');
      const donutEmpty = document.getElementById('chart-donut-empty');
      const hasChannelData = (channelData.online_centavos > 0 || channelData.walkin_centavos > 0 || (channelData.partner_centavos || 0) > 0);

      if (donutChartInstance) {
        donutChartInstance.destroy();
        donutChartInstance = null;
      }

      if (!hasChannelData) {
        if (donutCanvas) donutCanvas.style.display = 'none';
        if (donutEmpty) donutEmpty.style.display = 'flex';
      } else {
        if (donutCanvas) donutCanvas.style.display = 'block';
        if (donutEmpty) donutEmpty.style.display = 'none';

        donutChartInstance = new Chart(donutCanvas, {
          type: 'doughnut',
          data: {
            labels: [
              `Online Orders (${channelData.online_pct || 0}%)`,
              `Walk-In Cash (${channelData.walkin_pct || 0}%)`,
              `Partner Payments (${channelData.partner_pct || 0}%)`,
            ],
            datasets: [
              {
                data: [
                  channelData.online_centavos / 100,
                  channelData.walkin_centavos / 100,
                  (channelData.partner_centavos || 0) / 100,
                ],
                backgroundColor: ['#6B352A', '#2D6A4F', '#D97706'],
                hoverBackgroundColor: ['#8C4537', '#3E8E68', '#F59E0B'],
                borderWidth: 2,
                borderColor: '#FAF7F2',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  boxWidth: 12,
                  font: { size: 11, family: 'system-ui, sans-serif' },
                  color: '#3E241B',
                },
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => ` ₱${ctx.parsed.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                },
              },
            },
            cutout: '68%',
          },
        });
      }

    }

    // --- Render Top Products Widget (Pure HTML/CSS) ---
    function renderTopProductsWidget(topProducts) {
      const topContainer = document.getElementById('top-products-container');
      if (!topContainer) return;

      if (!topProducts || topProducts.length === 0) {
        topContainer.innerHTML = '<p class="text-muted" style="font-size:0.78rem; padding:0.5rem 0;">No product sales recorded in this period.</p>';
        return;
      }

      const maxRev = topProducts[0].total_centavos || 1;
      topContainer.innerHTML = topProducts.map((p) => {
        const pct = Math.min(100, Math.round(((p.total_centavos || 0) / maxRev) * 100));
        return `
          <div class="top-product-item">
            <div class="top-prod-info">
              <div class="top-prod-name" title="${esc(p.product_name)}">${esc(p.product_name)}</div>
              <div class="top-prod-bar-wrap">
                <div class="top-prod-bar-fill" style="width:${pct}%"></div>
              </div>
            </div>
            <div class="top-prod-numbers">
              <div class="top-prod-rev">${formatPesos(p.total_centavos)}</div>
              <div class="top-prod-bundles">${formatNumber(p.bundles_sold)} bdls</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // --- Render Recent Customer Payments Table ---
    function renderPartnerPaymentsTable(r) {
      const tbody = document.getElementById('partner-payments-tbody');
      const countBadge = document.getElementById('count-partner-payments');
      const periodLabel = document.getElementById('partner-payments-period-label');
      if (!tbody) return;

      const payments = r.partner_payments || [];
      if (countBadge) countBadge.textContent = String(payments.length);
      if (periodLabel) periodLabel.textContent = `For ${r.label || 'selected period'}`;

      if (payments.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8">
              <div class="friendly-empty-state" style="padding: 1.5rem 1rem;">
                <i class="fas fa-hand-holding-dollar" aria-hidden="true"></i>
                <h4 style="margin: 0.35rem 0; font-size: 0.95rem;">No customer payments recorded</h4>
                <p style="margin: 0; font-size: 0.8rem; color: #7A685D;">No manual partner payments logged during this period. Use "Record Payment" to log one.</p>
              </div>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = payments.map((p) => {
        const d = new Date(p.created_at);
        const dateStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
        const isVoid = !!p.is_voided;

        const actionHtml = isVoid
          ? `<span class="badge-voided" title="Voided: ${esc(p.void_reason || 'No reason provided')}"><i class="fas fa-ban"></i> Voided</span>`
          : `<button type="button" class="btn-void-payment" data-id="${p.id}" data-code="${esc(p.order_code)}" data-customer="${esc(p.customer_name)}" data-amount="${p.amount_centavos}"><i class="fas fa-ban"></i> Void</button>`;

        const amountHtml = isVoid
          ? `<span style="text-decoration:line-through; color:#991B1B;">${formatPesos(p.amount_centavos)}</span>`
          : `<strong>${formatPesos(p.amount_centavos)}</strong>`;

        const detailsParts = [];
        if (p.reference_number && p.reference_number !== '—') {
          detailsParts.push(`Ref: <code>${esc(p.reference_number)}</code>`);
        }
        if (p.notes) {
          detailsParts.push(esc(p.notes));
        }
        const notesRefHtml = detailsParts.length > 0 ? detailsParts.join('<br>') : '—';

        return `
          <tr class="${isVoid ? 'is-voided-row' : ''}">
            <td>
              <div><strong>${dateStr}</strong></div>
              <small class="text-muted">${timeStr}</small>
            </td>
            <td><strong>${esc(p.customer_name)}</strong></td>
            <td><span class="badge" style="background:#FAF7F2; border:1px solid #D5C2B4; font-weight:700;">#${esc(p.order_code)}</span></td>
            <td><span class="badge" style="background:#EFE8DE; color:#3E241B; font-weight:700;">${esc(p.payment_method)}</span></td>
            <td style="text-align:right;">${amountHtml}</td>
            <td><small class="text-muted">${esc(p.recorded_by)}</small></td>
            <td><small>${notesRefHtml}</small></td>
            <td style="text-align:center;">${actionHtml}</td>
          </tr>
        `;
      }).join('');

      // Attach void click listeners
      const voidButtons = tbody.querySelectorAll('.btn-void-payment');
      voidButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const code = btn.getAttribute('data-code');
          const customer = btn.getAttribute('data-customer');
          const amount = btn.getAttribute('data-amount');
          openVoidModal({ id, order_code: code, customer_name: customer, amount_centavos: amount });
        });
      });
    }

    // --- Tab 1: Render By Product Table ---
    function renderByProductTable(r) {
      const tbody = document.getElementById('sales-by-product-tbody');
      const tfoot = document.getElementById('sales-by-product-tfoot');
      if (!tbody) return;

      const items = (r.by_product || []).slice();

      if (items.length === 0) {
        const cashMsg = (r.metrics && r.metrics.cash_collected_centavos > 0)
          ? `<p style="font-size:0.8rem; color:#7A685D; margin-top:0.35rem;">Note: ${formatPesos(r.metrics.cash_collected_centavos)} in payments were collected in this period. Switch to the <strong>Payments</strong> tab to view them, or view <strong>This Week</strong> to see when the orders were booked.</p>`
          : '';

        tbody.innerHTML = `
          <tr>
            <td colspan="5">
              <div class="friendly-empty-state">
                <i class="fas fa-bread-slice" aria-hidden="true"></i>
                <h4>No products sold in this period</h4>
                <p>No customer orders were booked during this timeframe.</p>
                ${cashMsg}
                <button type="button" class="btn btn-outline btn-sm" id="btn-empty-try-week" style="margin-top:0.5rem;">
                  <i class="fas fa-calendar-week"></i> View This Week
                </button>
              </div>
            </td>
          </tr>
        `;
        if (tfoot) tfoot.innerHTML = '';

        const tryWeekBtn = document.getElementById('btn-empty-try-week');
        if (tryWeekBtn) {
          tryWeekBtn.addEventListener('click', () => {
            const btnWeekly = document.getElementById('period-btn-weekly');
            if (btnWeekly) btnWeekly.click();
          });
        }
        return;
      }

      // Sort items
      items.sort((a, b) => {
        let va = a[productSort.col];
        let vb = b[productSort.col];
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return productSort.dir === 'asc' ? -1 : 1;
        if (va > vb) return productSort.dir === 'asc' ? 1 : -1;
        return 0;
      });

      tbody.innerHTML = items.map((p) => {
        const share = p.share_pct != null ? p.share_pct : 0;
        return `
          <tr>
            <td><strong>${esc(p.product_name)}</strong></td>
            <td style="text-align:right;">${formatNumber(p.bundles_sold)} <span class="text-muted" style="font-size:0.75rem;">bdls</span></td>
            <td style="text-align:right;">${formatNumber(p.pieces_sold)} <span class="text-muted" style="font-size:0.75rem;">pcs</span></td>
            <td style="text-align:right;"><strong>${formatPesos(p.total_centavos)}</strong></td>
            <td style="text-align:right;">
              <div class="share-bar-cell">
                <div class="share-track">
                  <div class="share-fill" style="width:${Math.min(100, Math.max(0, share))}%"></div>
                </div>
                <span style="font-weight:700; font-size:0.78rem; min-width:38px;">${share.toFixed(1)}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Foot totals
      const totBundles = items.reduce((sum, p) => sum + (p.bundles_sold || 0), 0);
      const totPieces = items.reduce((sum, p) => sum + (p.pieces_sold || 0), 0);
      const totSales = items.reduce((sum, p) => sum + (p.total_centavos || 0), 0);

      if (tfoot) {
        tfoot.innerHTML = `
          <tr>
            <td>TOTALS</td>
            <td style="text-align:right;">${formatNumber(totBundles)} bdls</td>
            <td style="text-align:right;">${formatNumber(totPieces)} pcs</td>
            <td style="text-align:right;">${formatPesos(totSales)}</td>
            <td style="text-align:right;">100.0%</td>
          </tr>
        `;
      }
    }

    // --- Tab 2: Render Payments Received Table ---
    function renderPaymentsTable(r) {
      const tbody = document.getElementById('payments-tbody');
      const countBadge = document.getElementById('count-payments');
      const countLabel = document.getElementById('payments-count-label');
      const pageInfo = document.getElementById('pay-page-info');
      const btnPrev = document.getElementById('pay-btn-prev');
      const btnNext = document.getElementById('pay-btn-next');
      if (!tbody) return;

      const rawItems = r.payments || [];
      if (countBadge) countBadge.textContent = String(rawItems.length);

      // Filter by search
      const q = paySearch.trim().toLowerCase();
      const filtered = q
        ? rawItems.filter((p) =>
            (p.order_code || '').toLowerCase().includes(q) ||
            (p.customer_name || '').toLowerCase().includes(q) ||
            (p.reference_number || '').toLowerCase().includes(q))
        : rawItems;

      if (countLabel) countLabel.textContent = `${filtered.length} payment(s)`;

      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7">
              <div class="friendly-empty-state">
                <i class="fas fa-money-bill-wave" aria-hidden="true"></i>
                <h4>No payments found</h4>
                <p>${q ? 'No payments match your search query.' : 'No payments collected during this period.'}</p>
              </div>
            </td>
          </tr>
        `;
        if (pageInfo) pageInfo.textContent = 'Showing 0-0 of 0';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
      }

      // Pagination
      const totalPages = Math.ceil(filtered.length / payPageSize);
      if (payPage > totalPages) payPage = totalPages;
      if (payPage < 1) payPage = 1;

      const startIdx = (payPage - 1) * payPageSize;
      const endIdx = Math.min(startIdx + payPageSize, filtered.length);
      const pageItems = filtered.slice(startIdx, endIdx);

      if (pageInfo) pageInfo.textContent = `Showing ${startIdx + 1}–${endIdx} of ${filtered.length}`;
      if (btnPrev) btnPrev.disabled = (payPage <= 1);
      if (btnNext) btnNext.disabled = (payPage >= totalPages);

      tbody.innerHTML = pageItems.map((p) => {
        const d = new Date(p.created_at);
        const dateStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });

        let stageBadge = `<span class="badge-pay-stage badge-pay-stage--${(p.stage || '').toLowerCase()}">${esc(p.stage)}</span>`;
        if (p.stage === 'DOWNPAYMENT') {
          stageBadge = '<span class="badge-pay-stage badge-pay-stage--downpayment"><i class="fas fa-hourglass-half"></i> Downpayment</span>';
        } else if (p.stage === 'BALANCE') {
          stageBadge = '<span class="badge-pay-stage badge-pay-stage--balance"><i class="fas fa-check-double"></i> Balance</span>';
        } else if (p.stage === 'WALK_IN') {
          stageBadge = '<span class="badge-pay-stage badge-pay-stage--walkin"><i class="fas fa-cash-register"></i> Walk-In</span>';
        }

        return `
          <tr>
            <td>
              <div><strong>${dateStr}</strong></div>
              <small class="text-muted">${timeStr}</small>
            </td>
            <td><strong>${esc(p.order_code)}</strong></td>
            <td><span class="truncate-cell" title="${esc(p.customer_name)}">${esc(p.customer_name)}</span></td>
            <td>${stageBadge}</td>
            <td><span class="badge" style="background:#EFE8DE; color:#3E241B; font-weight:700;">${esc(p.channel)}</span></td>
            <td><code>${esc(p.reference_number)}</code></td>
            <td style="text-align:right;"><strong>${formatPesos(p.amount_centavos)}</strong></td>
          </tr>
        `;
      }).join('');
    }

    // --- Tab Switching & Table Listeners ---
    function initTabs() {
      const tabButtons = document.querySelectorAll('.tab-pill');
      const tabPanes = document.querySelectorAll('.tab-pane');

      tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-tab');
          tabButtons.forEach((b) => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          tabPanes.forEach((p) => p.classList.remove('is-active'));

          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          const activePane = document.getElementById(target);
          if (activePane) activePane.classList.add('is-active');
          activeTab = target;
        });
      });

      // "View full breakdown" link
      const viewAllLink = document.getElementById('link-view-all-products');
      if (viewAllLink) {
        viewAllLink.addEventListener('click', (e) => {
          e.preventDefault();
          const btnProd = document.getElementById('tab-btn-by-product');
          if (btnProd) btnProd.click();
          const table = document.getElementById('table-by-product');
          if (table) table.scrollIntoView({ behavior: 'smooth' });
        });
      }

      // Sortable headers on By Product table
      const sortableHeaders = document.querySelectorAll('#table-by-product th.sortable');
      sortableHeaders.forEach((th) => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
          const col = th.getAttribute('data-sort');
          if (productSort.col === col) {
            productSort.dir = productSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            productSort.col = col;
            productSort.dir = (col === 'product_name') ? 'asc' : 'desc';
          }
          if (cachedReport) renderByProductTable(cachedReport);
        });
      });

      // Search Payments
      const payInput = document.getElementById('search-payments');
      if (payInput) {
        payInput.addEventListener('input', (e) => {
          paySearch = e.target.value;
          payPage = 1;
          if (cachedReport) renderPaymentsTable(cachedReport);
        });
      }

      const payPrev = document.getElementById('pay-btn-prev');
      const payNext = document.getElementById('pay-btn-next');
      if (payPrev) {
        payPrev.addEventListener('click', () => {
          if (payPage > 1) {
            payPage--;
            if (cachedReport) renderPaymentsTable(cachedReport);
          }
        });
      }
      if (payNext) {
        payNext.addEventListener('click', () => {
          payPage++;
          if (cachedReport) renderPaymentsTable(cachedReport);
        });
      }
    }

    // --- Modal Helpers ---
    function openModal(modalEl) {
      if (modalEl) modalEl.classList.add('active');
    }

    function closeModal(modalEl) {
      if (modalEl) modalEl.classList.remove('active');
    }

    let openVoidModal = () => {};

    // --- Record Payment Modal Initialization ---
    function initRecordPaymentModal() {
      const openBtn = document.getElementById('btn-open-record-payment');
      const modal = document.getElementById('modal-record-payment');
      const closeBtn = document.getElementById('btn-close-record-payment');
      const cancelBtn = document.getElementById('btn-cancel-record-payment');
      const form = document.getElementById('record-payment-form');
      const customerSelect = document.getElementById('pay-customer-select');
      const orderSelect = document.getElementById('pay-order-select');
      const balanceDetails = document.getElementById('order-balance-details');
      const dtlTotal = document.getElementById('dtl-order-total');
      const dtlPaid = document.getElementById('dtl-order-paid');
      const dtlRemaining = document.getElementById('dtl-order-remaining');
      const amountInput = document.getElementById('pay-amount-input');
      const btnPayFull = document.getElementById('btn-pay-full-balance');
      const previewText = document.getElementById('preview-balance-text');
      const methodSelect = document.getElementById('pay-method-select');
      const dateInput = document.getElementById('pay-date-input');
      const refInput = document.getElementById('pay-ref-input');
      const notesInput = document.getElementById('pay-notes-input');
      const errorBox = document.getElementById('record-payment-error');
      const saveBtn = document.getElementById('btn-save-record-payment');

      if (!openBtn || !modal) return;

      function updatePreview() {
        if (!selectedOrder) return;
        const bal = selectedOrder.balance_due_centavos || 0;
        const val = parseFloat(amountInput.value);
        if (isNaN(val) || val <= 0) {
          previewText.textContent = formatPesos(bal);
          previewText.style.color = '#4A3B32';
          return;
        }
        const amtCentavos = Math.round(val * 100);
        const rem = bal - amtCentavos;
        if (rem < 0) {
          previewText.textContent = `Amount exceeds balance by ${formatPesos(Math.abs(rem))}`;
          previewText.style.color = '#B91C1C';
        } else if (rem === 0) {
          previewText.textContent = '₱0.00 (Fully Paid)';
          previewText.style.color = '#2D6A4F';
        } else {
          previewText.textContent = `${formatPesos(rem)} remaining`;
          previewText.style.color = '#D97706';
        }
      }

      openBtn.addEventListener('click', () => {
        // Reset modal state
        cachedUnpaidCustomers = [];
        selectedCustomerOrders = [];
        selectedOrder = null;

        customerSelect.innerHTML = '<option value="" disabled selected>Loading customers with balance…</option>';
        orderSelect.innerHTML = '<option value="" disabled selected>Choose a customer first…</option>';
        orderSelect.disabled = true;
        balanceDetails.style.display = 'none';

        amountInput.value = '';
        amountInput.disabled = true;
        btnPayFull.disabled = true;
        previewText.textContent = '₱0.00';
        previewText.style.color = '#4A3B32';

        const today = getManilaToday();
        dateInput.value = today;
        dateInput.max = today;
        refInput.value = '';
        notesInput.value = '';

        errorBox.style.display = 'none';
        errorBox.textContent = '';
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Payment';

        openModal(modal);

        // Fetch unpaid orders
        api.unpaidOrders().then((res) => {
          cachedUnpaidCustomers = (res && res.customers) || [];
          if (cachedUnpaidCustomers.length === 0) {
            customerSelect.innerHTML = '<option value="" disabled selected>No customers with unpaid balance</option>';
            return;
          }
          customerSelect.innerHTML = '<option value="" disabled selected>Select customer or partner…</option>' +
            cachedUnpaidCustomers.map((c, idx) => `
              <option value="${idx}">${esc(c.customer_name)} (${c.orders.length} order${c.orders.length > 1 ? 's' : ''} with balance)</option>
            `).join('');
        }).catch((err) => {
          customerSelect.innerHTML = '<option value="" disabled selected>Error loading customers</option>';
          errorBox.textContent = 'Failed to load unpaid customers: ' + err.message;
          errorBox.style.display = 'block';
        });
      });

      customerSelect.addEventListener('change', () => {
        const custIdx = parseInt(customerSelect.value, 10);
        const cust = cachedUnpaidCustomers[custIdx];
        if (!cust) return;

        selectedCustomerOrders = cust.orders || [];
        orderSelect.disabled = false;
        orderSelect.innerHTML = '<option value="" disabled selected>Select an order to pay…</option>' +
          selectedCustomerOrders.map((o, idx) => `
            <option value="${idx}">Order #${esc(o.order_code)} — ${formatPesos(o.balance_due_centavos)} due</option>
          `).join('');

        balanceDetails.style.display = 'none';
        amountInput.disabled = true;
        amountInput.value = '';
        btnPayFull.disabled = true;
        selectedOrder = null;
        previewText.textContent = '₱0.00';
        previewText.style.color = '#4A3B32';
      });

      orderSelect.addEventListener('change', () => {
        const ordIdx = parseInt(orderSelect.value, 10);
        selectedOrder = selectedCustomerOrders[ordIdx];
        if (!selectedOrder) return;

        dtlTotal.textContent = formatPesos(selectedOrder.total_centavos || 0);
        dtlPaid.textContent = formatPesos(selectedOrder.amount_paid_centavos || 0);
        dtlRemaining.textContent = formatPesos(selectedOrder.balance_due_centavos || 0);
        balanceDetails.style.display = 'block';

        amountInput.disabled = false;
        const maxPesos = (selectedOrder.balance_due_centavos / 100).toFixed(2);
        amountInput.max = maxPesos;
        amountInput.placeholder = `Up to ${maxPesos}`;
        amountInput.value = maxPesos; // Pre-fill with remaining balance
        btnPayFull.disabled = false;

        updatePreview();
      });

      amountInput.addEventListener('input', updatePreview);

      btnPayFull.addEventListener('click', () => {
        if (!selectedOrder) return;
        amountInput.value = (selectedOrder.balance_due_centavos / 100).toFixed(2);
        updatePreview();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';

        if (!selectedOrder) {
          errorBox.textContent = 'Please choose a customer and order with an unpaid balance.';
          errorBox.style.display = 'block';
          return;
        }

        const custIdx = parseInt(customerSelect.value, 10);
        const cust = cachedUnpaidCustomers[custIdx];
        const custName = cust ? cust.customer_name : '';

        const val = parseFloat(amountInput.value);
        const amtCentavos = Math.round(val * 100);
        const bal = selectedOrder.balance_due_centavos || 0;

        if (isNaN(val) || amtCentavos <= 0) {
          errorBox.textContent = 'Payment amount must be greater than ₱0.00.';
          errorBox.style.display = 'block';
          return;
        }

        if (amtCentavos > bal) {
          errorBox.textContent = `Amount (${formatPesos(amtCentavos)}) cannot exceed remaining balance (${formatPesos(bal)}).`;
          errorBox.style.display = 'block';
          return;
        }

        const payDate = dateInput.value;
        const today = getManilaToday();
        if (!payDate) {
          errorBox.textContent = 'Date received is required.';
          errorBox.style.display = 'block';
          return;
        }
        if (payDate > today) {
          errorBox.textContent = 'Date received cannot be in the future.';
          errorBox.style.display = 'block';
          return;
        }

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

        try {
          await api.recordPartnerPayment({
            customer_name: custName,
            order_id: selectedOrder.id,
            amount: val,
            payment_method: methodSelect.value,
            date_received: payDate,
            reference_number: refInput.value.trim(),
            notes: notesInput.value.trim(),
          });

          closeModal(modal);
          showToast(`Payment of ${formatPesos(amtCentavos)} recorded for Order #${selectedOrder.order_code}.`, 'success');

          loadSalesData(false);
          try {
            localStorage.setItem('webake_order_updated', String(Date.now()));
          } catch (_) {}
        } catch (err) {
          console.error('Failed to record payment:', err);
          errorBox.textContent = err.message || 'Failed to record payment.';
          errorBox.style.display = 'block';
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Payment';
        }
      });

      if (closeBtn) closeBtn.addEventListener('click', () => closeModal(modal));
      if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal(modal));
    }

    // --- Void Payment Modal Initialization ---
    function initVoidPaymentModal() {
      const modal = document.getElementById('modal-void-payment');
      const closeBtn = document.getElementById('btn-close-void-payment');
      const cancelBtn = document.getElementById('btn-cancel-void-payment');
      const form = document.getElementById('void-payment-form');
      const idInput = document.getElementById('void-payment-id');
      const summaryBox = document.getElementById('void-payment-summary');
      const reasonInput = document.getElementById('void-reason-input');
      const errorBox = document.getElementById('void-payment-error');
      const confirmBtn = document.getElementById('btn-confirm-void-payment');

      if (!modal) return;

      openVoidModal = function (payment) {
        idInput.value = payment.id;
        summaryBox.innerHTML = `
          <div><strong>Order:</strong> #${esc(payment.order_code)}</div>
          <div><strong>Customer / Partner:</strong> ${esc(payment.customer_name)}</div>
          <div><strong>Amount Received:</strong> ${formatPesos(payment.amount_centavos)}</div>
        `;
        reasonInput.value = '';
        errorBox.style.display = 'none';
        errorBox.textContent = '';
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-ban"></i> Void Payment';
        openModal(modal);
      };

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';

        const paymentId = parseInt(idInput.value, 10);
        const reason = reasonInput.value.trim();

        if (!paymentId) {
          errorBox.textContent = 'Invalid payment selected.';
          errorBox.style.display = 'block';
          return;
        }

        if (!reason) {
          errorBox.textContent = 'Please provide a reason for voiding this payment.';
          errorBox.style.display = 'block';
          return;
        }

        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Voiding…';

        try {
          await api.voidPartnerPayment(paymentId, { reason });
          closeModal(modal);
          showToast('Payment voided. Order balance has been restored.', 'success');

          loadSalesData(false);
          try {
            localStorage.setItem('webake_order_updated', String(Date.now()));
          } catch (_) {}
        } catch (err) {
          console.error('Failed to void payment:', err);
          errorBox.textContent = err.message || 'Failed to void payment.';
          errorBox.style.display = 'block';
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = '<i class="fas fa-ban"></i> Void Payment';
        }
      });

      if (closeBtn) closeBtn.addEventListener('click', () => closeModal(modal));
      if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal(modal));

      // Global backdrop & Esc handling for both modals
      [document.getElementById('modal-record-payment'), modal].forEach((m) => {
        if (!m) return;
        m.addEventListener('click', (e) => {
          if (e.target === m) closeModal(m);
        });
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeModal(document.getElementById('modal-record-payment'));
          closeModal(modal);
        }
      });
    }

    // --- Lifecycle, Visibility & Auto-Refresh ---
    function initLifecycle() {
      // 60-second auto-refresh
      autoRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          loadSalesData(false);
        }
      }, 60000);

      // Relative timestamp timer (every 15s)
      timeAgoTimer = setInterval(updateTimestampText, 15000);

      // Refetch when tab regains focus or visibility
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          loadSalesData(false);
        }
      });

      window.addEventListener('focus', () => {
        loadSalesData(false);
      });

      // Cross-tab storage synchronization
      window.addEventListener('storage', (e) => {
        if (e.key === 'webake_sale_updated' || e.key === 'webake_order_updated') {
          loadSalesData(false);
        }
      });
    }

    // --- Boot sequence ---
    readUrlParams();
    initToolbar();
    initExportDropdown();
    initRecordPaymentModal();
    initVoidPaymentModal();
    initTabs();
    initLifecycle();

    // Initial load
    loadSalesData();
  });
})();
