/**
 * admin-sales: Today, Weekly, and Monthly sales reporting + PDF report export.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('sales-by-product-tbody')) return;

    const ui = window.AdminUI;
    const api = window.AdminAPI;

    const periodSelect = document.getElementById('sales-period-select');
    const anchorInput = document.getElementById('sales-anchor-date');
    const refreshBtn = document.getElementById('btn-refresh-sales');
    const exportBtn = document.getElementById('btn-export-sales-pdf');
    const quickExportBtn = document.getElementById('btn-quick-export');

    // Default anchor date to today in local YYYY-MM-DD
    const todayIso = new Date().toISOString().slice(0, 10);
    if (anchorInput && !anchorInput.value) {
      anchorInput.value = todayIso;
    }

    async function loadKpis() {
      try {
        const [dailyRes, weeklyRes, monthlyRes] = await Promise.all([
          api.salesReport('daily'),
          api.salesReport('weekly'),
          api.salesReport('monthly'),
        ]);

        const dSum = (dailyRes.report && dailyRes.report.summary) || {};
        const wSum = (weeklyRes.report && weeklyRes.report.summary) || {};
        const mSum = (monthlyRes.report && monthlyRes.report.summary) || {};

        document.getElementById('stat-today-sales').textContent = ui.pesos(dSum.collected_centavos || 0);
        document.getElementById('stat-today-sub').textContent = (dSum.total_orders || 0) + ' orders today';

        document.getElementById('stat-week-sales').textContent = ui.pesos(wSum.collected_centavos || 0);
        document.getElementById('stat-week-sub').textContent = (wSum.total_orders || 0) + ' orders this week';

        document.getElementById('stat-month-sales').textContent = ui.pesos(mSum.collected_centavos || 0);
        document.getElementById('stat-month-sub').textContent = (mSum.total_orders || 0) + ' orders this month';
      } catch (err) {
        console.error('Failed to load sales KPIs', err);
      }
    }

    async function loadReport() {
      const period = periodSelect ? periodSelect.value : 'daily';
      const anchor = anchorInput ? anchorInput.value : undefined;
      const tbody = document.getElementById('sales-by-product-tbody');

      tbody.innerHTML = '<tr><td colspan="5" class="muted text-center" style="padding:2rem;">Loading sales report…</td></tr>';

      try {
        const { report: r } = await api.salesReport(period, anchor || undefined);
        const sum = r.summary || {};

        const rangeFrom = r.from ? r.from.slice(0, 10) : '';
        const rangeTo = r.to ? r.to.slice(0, 10) : '';
        const dateRangeStr = (rangeFrom && rangeTo) ? ' (' + rangeFrom + ' to ' + rangeTo + ')' : '';
        document.getElementById('sales-period-label').textContent =
          'Report for: ' + (r.label || period) + dateRangeStr;

        document.getElementById('stat-net-sales').textContent = ui.pesos(sum.net_collected_centavos || 0);
        document.getElementById('stat-refund-sub').textContent = ui.pesos(sum.refunded_centavos || 0) + ' refunded';

        document.getElementById('sum-online-amt').textContent = ui.pesos(sum.online_collected_centavos || 0);
        document.getElementById('sum-walkin-amt').textContent = ui.pesos(sum.walkin_collected_centavos || 0);
        document.getElementById('sum-bundles-count').textContent = (sum.total_bundles || 0) + ' bdls';
        document.getElementById('sum-orders-count').textContent = String(sum.total_orders || 0);

        const items = r.by_product || [];
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="muted text-center" style="padding:2rem;">No products were sold during this period.</td></tr>';
          return;
        }

        const totalCentavos = sum.collected_centavos || 1;
        tbody.innerHTML = items.map((p) => {
          const sharePct = ((p.total_centavos / totalCentavos) * 100).toFixed(1);
          return '<tr>' +
            '<td><strong>' + ui.esc(p.product_name) + '</strong></td>' +
            '<td>' + (p.bundles_sold || 0) + ' bdls</td>' +
            '<td>' + (p.pieces_sold || 0) + ' pcs</td>' +
            '<td><strong>' + ui.pesos(p.total_centavos) + '</strong></td>' +
            '<td style="text-align:right;"><span class="badge" style="background:#FBF3E8;color:#6B352A;padding:0.25rem 0.6rem;border-radius:6px;font-weight:600;">' + sharePct + '%</span></td>' +
            '</tr>';
        }).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-danger text-center" style="padding:2rem;">Failed to load report: ' + ui.esc(err.message) + '</td></tr>';
      }
    }

    async function downloadPdf() {
      const period = periodSelect ? periodSelect.value : 'daily';
      const anchor = anchorInput ? anchorInput.value : undefined;

      const btn = exportBtn;
      if (btn) btn.disabled = true;
      if (quickExportBtn) quickExportBtn.disabled = true;

      try {
        const { blob, filename } = await api.salesPdf(period, anchor || undefined);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || ('webake-sales-' + period + '.pdf');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch (err) {
        window.alert(err.message || 'PDF export failed.');
      } finally {
        if (btn) btn.disabled = false;
        if (quickExportBtn) quickExportBtn.disabled = false;
      }
    }

    if (periodSelect) periodSelect.addEventListener('change', loadReport);
    if (anchorInput) anchorInput.addEventListener('change', loadReport);
    if (refreshBtn) refreshBtn.addEventListener('click', () => { loadKpis(); loadReport(); });
    if (exportBtn) exportBtn.addEventListener('click', downloadPdf);
    if (quickExportBtn) quickExportBtn.addEventListener('click', downloadPdf);

    loadKpis();
    loadReport();
  });
})();

