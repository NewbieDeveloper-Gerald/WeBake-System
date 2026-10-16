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
    let compare = true;
    let cachedReport = null;
    let activeTab = 'tab-by-product';

    let productSort = { col: 'total_centavos', dir: 'desc' };

    let transSearch = '';
    let transPage = 1;
    const transPageSize = 10;

    let paySearch = '';
    let payPage = 1;
    const payPageSize = 10;

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
        const c = params.get('compare');
        if (c !== null) compare = (c === '1' || c === 'true');
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
        params.set('compare', compare ? '1' : '0');
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
      const compareCheckbox = document.getElementById('toggle-compare');
      const presetButtons = document.querySelectorAll('.preset-pill');

      const today = getManilaToday();
      if (startDateInput && !startDateInput.value) startDateInput.value = customFrom || today;
      if (endDateInput && !endDateInput.value) endDateInput.value = customTo || today;
      if (compareCheckbox) compareCheckbox.checked = compare;

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

      if (compareCheckbox) {
        compareCheckbox.addEventListener('change', () => {
          compare = compareCheckbox.checked;
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
      const btnCsvTrans = document.getElementById('btn-export-csv-transactions');
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

      // CSV Transactions Export
      if (btnCsvTrans) {
        btnCsvTrans.addEventListener('click', () => {
          menu.classList.remove('is-open');
          if (!cachedReport || !cachedReport.transactions || cachedReport.transactions.length === 0) {
            showToast('No transactions to export for this period.', 'info');
            return;
          }
          try {
            exportTransactionsCsv(cachedReport.transactions, cachedReport.label);
            showToast('Transactions CSV exported.', 'success');
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

    function exportTransactionsCsv(transactions, periodLabel) {
      const headers = ['Date', 'Time (Manila)', 'Reference', 'Customer', 'Channel', 'Status', 'Payment Method', 'Amount (PHP)', 'Downpayment Paid (PHP)', 'Balance Due (PHP)'];
      const rows = transactions.map((t) => {
        const d = new Date(t.created_at);
        const dateStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila' });
        const timeStr = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' });
        return [
          `"${dateStr}"`,
          `"${timeStr}"`,
          `"${t.code || ''}"`,
          `"${(t.customer || '').replace(/"/g, '""')}"`,
          `"${t.channel}"`,
          `"${t.status}"`,
          `"${t.payment_method || 'CASH'}"`,
          (t.amount_centavos / 100).toFixed(2),
          (t.downpayment_paid_centavos / 100).toFixed(2),
          (t.balance_centavos / 100).toFixed(2),
        ].join(',');
      });
      const csv = [headers.join(','), ...rows].join('\r\n');
      const filename = `webake-transactions-${currentPeriod}-${getManilaToday()}.csv`;
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
          compare: compare ? '1' : '0',
        };

        const res = await api.salesReport(queryParams);
        const report = res.report || {};
        cachedReport = report;
        lastUpdated = new Date();
        updateTimestampText();

        // 1. Period Header & Label
        const rangeTextEl = document.getElementById('period-human-text');
        if (rangeTextEl) rangeTextEl.textContent = report.label || 'Selected Period';

        // 2. Render Primary KPI Cards
        renderKpiCards(report);

        // 3. Render Secondary Metrics Strip
        renderSecondaryMetrics(report);

        // 4. Update Sidebar Badges dynamically
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

        // 5. Render Charts
        renderCharts(report);

        // 6. Render Tabbed Tables
        renderByProductTable(report);
        renderTransactionsTable(report);
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

    // --- Render Primary KPI Cards ---
    function renderKpiCards(r) {
      const m = r.metrics || {};
      const deltas = r.deltas || {};
      const compLabel = r.comparison_label || 'vs previous';

      function renderDelta(pct) {
        if (pct === null || pct === undefined || isNaN(pct)) return '—';
        if (pct > 0) return `<span class="delta-badge is-positive"><i class="fas fa-arrow-up" aria-hidden="true"></i> +${pct}% ${compLabel}</span>`;
        if (pct < 0) return `<span class="delta-badge is-negative"><i class="fas fa-arrow-down" aria-hidden="true"></i> ${pct}% ${compLabel}</span>`;
        return `<span class="delta-badge is-neutral">0% ${compLabel}</span>`;
      }

      // Net Revenue
      const netValEl = document.getElementById('kpi-net-revenue');
      const netSubEl = document.getElementById('kpi-net-revenue-sub');
      const netDeltaEl = document.getElementById('kpi-net-revenue-delta');
      if (netValEl) netValEl.textContent = formatPesos(m.net_revenue_centavos);
      if (netSubEl) {
        const refCentavos = m.refunds_centavos || 0;
        netSubEl.textContent = refCentavos > 0
          ? `${formatPesos(refCentavos)} refunded`
          : '₱0.00 refunded';
      }
      if (netDeltaEl) netDeltaEl.innerHTML = renderDelta(deltas.net_revenue_pct);

      // Cash Collected
      const cashValEl = document.getElementById('kpi-cash-collected');
      const cashSubEl = document.getElementById('kpi-cash-collected-sub');
      const cashDeltaEl = document.getElementById('kpi-cash-collected-delta');
      if (cashValEl) cashValEl.textContent = formatPesos(m.cash_collected_centavos);
      if (cashSubEl) cashSubEl.textContent = `${formatNumber(m.payments_count || 0)} payment(s) collected`;
      if (cashDeltaEl) cashDeltaEl.innerHTML = renderDelta(deltas.cash_collected_pct);

      // Booked Sales
      const bookedValEl = document.getElementById('kpi-booked-sales');
      const bookedSubEl = document.getElementById('kpi-booked-sales-sub');
      const bookedDeltaEl = document.getElementById('kpi-booked-sales-delta');
      if (bookedValEl) bookedValEl.textContent = formatPesos(m.booked_sales_centavos);
      if (bookedSubEl) bookedSubEl.textContent = `${formatNumber(m.total_orders || 0)} total order(s)`;
      if (bookedDeltaEl) bookedDeltaEl.innerHTML = renderDelta(deltas.booked_sales_pct);

      // Outstanding Balance
      const outValEl = document.getElementById('kpi-outstanding-balance');
      const outSubEl = document.getElementById('kpi-outstanding-sub');
      const outDeltaEl = document.getElementById('kpi-outstanding-delta');
      const outBal = m.outstanding_balance_centavos || 0;
      if (outValEl) outValEl.textContent = formatPesos(outBal);
      if (outSubEl) {
        outSubEl.textContent = outBal > 0
          ? 'Unpaid balance · Click to review'
          : 'All orders in period paid in full';
      }
      if (outDeltaEl) outDeltaEl.innerHTML = renderDelta(deltas.outstanding_balance_pct);
    }

    // --- Render Secondary Metrics ---
    function renderSecondaryMetrics(r) {
      const m = r.metrics || {};
      const onEl = document.getElementById('sec-online-sales');
      const onSubEl = document.getElementById('sec-online-sub');
      const wkEl = document.getElementById('sec-walkin-sales');
      const wkSubEl = document.getElementById('sec-walkin-sub');
      const refEl = document.getElementById('sec-refunds');
      const refSubEl = document.getElementById('sec-refunds-sub');
      const aovEl = document.getElementById('sec-aov');

      if (onEl) onEl.textContent = formatPesos(m.online_booked_centavos);
      if (onSubEl) onSubEl.textContent = `${formatNumber(m.online_orders || 0)} online order(s)`;

      if (wkEl) wkEl.textContent = formatPesos(m.walkin_booked_centavos);
      if (wkSubEl) wkSubEl.textContent = `${formatNumber(m.walkin_sales || 0)} counter sale(s)`;

      if (refEl) refEl.textContent = formatPesos(m.refunds_centavos);
      if (refSubEl) refSubEl.textContent = `${formatNumber(m.refunds_count || 0)} request(s) refunded`;

      if (aovEl) aovEl.textContent = formatPesos(m.aov_centavos);
    }

    // --- Render Charts with Chart.js ---
    function renderCharts(r) {
      if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded');
        return;
      }

      const chartsData = r.charts || {};
      const trendData = chartsData.trend || [];
      const channelData = chartsData.channel_split || { online_centavos: 0, walkin_centavos: 0, online_pct: 0, walkin_pct: 0 };
      const topProducts = chartsData.top_products || [];

      // 1. Trend Chart
      const trendCanvas = document.getElementById('chart-revenue-trend-canvas');
      const trendEmpty = document.getElementById('chart-trend-empty');
      const hasTrendData = trendData.some((b) => (b.online_centavos > 0 || b.walkin_centavos > 0));

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
      const hasChannelData = (channelData.online_centavos > 0 || channelData.walkin_centavos > 0);

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
              `Online (${channelData.online_pct}%)`,
              `Walk-In (${channelData.walkin_pct}%)`,
            ],
            datasets: [
              {
                data: [
                  channelData.online_centavos / 100,
                  channelData.walkin_centavos / 100,
                ],
                backgroundColor: ['#6B352A', '#2D6A4F'],
                hoverBackgroundColor: ['#8C4537', '#3E8E68'],
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

      // 3. Top Products Mini Widget
      const topContainer = document.getElementById('top-products-container');
      if (topContainer) {
        if (!topProducts || topProducts.length === 0) {
          topContainer.innerHTML = '<p class="text-muted" style="font-size:0.78rem; padding:0.5rem 0;">No product sales recorded in this period.</p>';
        } else {
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
      }
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

    // --- Tab 2: Render Transactions Table ---
    function renderTransactionsTable(r) {
      const tbody = document.getElementById('transactions-tbody');
      const countBadge = document.getElementById('count-transactions');
      const countLabel = document.getElementById('transactions-count-label');
      const pageInfo = document.getElementById('trans-page-info');
      const btnPrev = document.getElementById('trans-btn-prev');
      const btnNext = document.getElementById('trans-btn-next');
      if (!tbody) return;

      const rawItems = r.transactions || [];
      if (countBadge) countBadge.textContent = String(rawItems.length);

      // Filter by search
      const q = transSearch.trim().toLowerCase();
      const filtered = q
        ? rawItems.filter((t) => (t.code || '').toLowerCase().includes(q) || (t.customer || '').toLowerCase().includes(q))
        : rawItems;

      if (countLabel) countLabel.textContent = `${filtered.length} transaction(s)`;

      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7">
              <div class="friendly-empty-state">
                <i class="fas fa-receipt" aria-hidden="true"></i>
                <h4>No transactions found</h4>
                <p>${q ? 'No orders match your search query.' : 'No orders or sales were booked in this period.'}</p>
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
      const totalPages = Math.ceil(filtered.length / transPageSize);
      if (transPage > totalPages) transPage = totalPages;
      if (transPage < 1) transPage = 1;

      const startIdx = (transPage - 1) * transPageSize;
      const endIdx = Math.min(startIdx + transPageSize, filtered.length);
      const pageItems = filtered.slice(startIdx, endIdx);

      if (pageInfo) pageInfo.textContent = `Showing ${startIdx + 1}–${endIdx} of ${filtered.length}`;
      if (btnPrev) btnPrev.disabled = (transPage <= 1);
      if (btnNext) btnNext.disabled = (transPage >= totalPages);

      tbody.innerHTML = pageItems.map((t) => {
        const d = new Date(t.created_at);
        const dateStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
        const channelBadge = t.channel === 'ONLINE'
          ? '<span class="badge-channel badge-channel--online"><i class="fas fa-globe"></i> Online</span>'
          : '<span class="badge-channel badge-channel--walkin"><i class="fas fa-store"></i> Walk-In</span>';

        const linkUrl = t.channel === 'ONLINE' ? `orders.html?search=${encodeURIComponent(t.code)}` : '#';

        return `
          <tr>
            <td>
              <div><strong>${dateStr}</strong></div>
              <small class="text-muted">${timeStr}</small>
            </td>
            <td>
              ${t.channel === 'ONLINE' ? `<a href="${linkUrl}" class="order-id-link"><strong>${esc(t.code)}</strong></a>` : `<strong>${esc(t.code)}</strong>`}
            </td>
            <td><span class="truncate-cell" title="${esc(t.customer)}">${esc(t.customer)}</span></td>
            <td>${channelBadge}</td>
            <td><span class="badge-status badge-${(t.status || '').toLowerCase().replace(/_/g, '-')}">${esc(t.status)}</span></td>
            <td style="text-align:right;"><strong>${formatPesos(t.amount_centavos)}</strong></td>
            <td style="text-align:right;">
              ${t.balance_centavos > 0
                ? `<span style="color:#B91C1C; font-weight:700;">${formatPesos(t.balance_centavos)}</span>`
                : '<span class="text-success"><i class="fas fa-check"></i> Paid</span>'}
            </td>
          </tr>
        `;
      }).join('');
    }

    // --- Tab 3: Render Payments Table ---
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

      // Search Transactions
      const transInput = document.getElementById('search-transactions');
      if (transInput) {
        transInput.addEventListener('input', (e) => {
          transSearch = e.target.value;
          transPage = 1;
          if (cachedReport) renderTransactionsTable(cachedReport);
        });
      }

      const transPrev = document.getElementById('trans-btn-prev');
      const transNext = document.getElementById('trans-btn-next');
      if (transPrev) {
        transPrev.addEventListener('click', () => {
          if (transPage > 1) {
            transPage--;
            if (cachedReport) renderTransactionsTable(cachedReport);
          }
        });
      }
      if (transNext) {
        transNext.addEventListener('click', () => {
          transPage++;
          if (cachedReport) renderTransactionsTable(cachedReport);
        });
      }

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
    initTabs();
    initLifecycle();

    // Initial load
    loadSalesData();
  });
})();
