/**
 * admin-dashboard: stat cards, refund alert, queues, and PDF export.
 *
 * WHAT: Loads ONE dashboard payload, renders every card, and wires the
 * sales-report viewer + PDF download (blob URL, no page navigation).
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('stat-online')) return; // not the dashboard

    const ui = window.AdminUI;
    const api = window.AdminAPI;

    async function load() {
      const { stats: s } = await api.dashboardStats();

      const onlineCollected = s.sales_today.online_collected_centavos != null
        ? s.sales_today.online_collected_centavos
        : (s.sales_today.online_gross_centavos || 0);
      const walkinCollected = s.sales_today.walkin_gross_centavos || 0;
      const combinedTotal = s.sales_today.combined_centavos != null
        ? s.sales_today.combined_centavos
        : (onlineCollected + walkinCollected);

      set('stat-combined', ui.pesos(combinedTotal));
      set('stat-online', ui.pesos(onlineCollected));
      set('stat-online-count', (s.sales_today.online_count || 0) + ' order(s)');
      set('stat-walkin', ui.pesos(walkinCollected));
      set('stat-walkin-count', (s.sales_today.walkin_count || 0) + ' sale(s)');
      set('stat-pending', String(s.pending_verification));
      set('stat-outstanding', ui.pesos(s.outstanding_balances_centavos));

      // Refund alert (spec Q13: visible until nothing needs action).
      const alerts = (s.refunds && s.refunds.alert_count) || 0;
      document.getElementById('refund-alert-card').hidden = alerts === 0;
      set('refund-alert-count', String(alerts));

      // Orders by status.
      const entries = Object.entries(s.orders_by_status || {});
      document.getElementById('status-breakdown').innerHTML = entries.length
        ? entries.map(([st, n]) =>
            '<div class="status-row">' + ui.pill(st) +
            '<strong>' + n + '</strong></div>').join('')
        : '<p class="muted">No orders yet.</p>';

      // Low stock.
      const low = s.low_stock || [];
      document.getElementById('lowstock-tbody').innerHTML = low.length
        ? low.map((p) =>
            '<tr><td>' + ui.esc(p.name) + '</td><td>' +
            p.stock_pieces + ' pcs (' + p.bundles_available + ' bdl)</td><td>' +
            ui.pill(p.stock_status) + '</td></tr>').join('')
        : '<tr><td colspan="3" class="muted">All stocked.</td></tr>';

      // Recent orders.
      const recent = s.recent_orders || [];
      document.getElementById('recent-tbody').innerHTML = recent.length
        ? recent.map((o) =>
            '<tr><td><strong>' + ui.esc(o.order_code) + '</strong></td><td>' +
            ui.esc(o.customer_name) + '</td><td>' + ui.pesos(o.total_centavos) +
            '</td><td>' + ui.pill(o.status) + '</td><td>' +
            ui.fmtDate(o.created_at) + '</td></tr>').join('')
        : '<tr><td colspan="5" class="muted">No orders yet.</td></tr>';
    }

    function set(id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    }

    // --- sales report viewer + PDF export (same data both ways) ---
    async function viewReport() {
      const box = document.getElementById('report-summary');
      try {
        const { report: r } = await api.salesReport(
          document.getElementById('report-period').value,
          document.getElementById('report-anchor').value || undefined
        );
        box.innerHTML =
          '<div class="report-line"><span>Period</span><strong>' + ui.esc(r.label) + '</strong></div>' +
          '<div class="report-line"><span>Online</span><strong>' + r.online.orders +
          ' orders, ' + ui.pesos(r.online.gross_centavos) + '</strong></div>' +
          '<div class="report-line"><span>Walk-in</span><strong>' + r.walkin.sales +
          ' sales, ' + ui.pesos(r.walkin.gross_centavos) + '</strong></div>' +
          '<div class="report-line"><span>Combined gross</span><strong>' +
          ui.pesos(r.combined_gross_centavos) + '</strong></div>' +
          '<div class="report-line"><span>Collected</span><strong>' +
          ui.pesos(r.collected_centavos) + '</strong></div>' +
          '<div class="report-line"><span>Refunded</span><strong>' +
          ui.pesos(r.refunded.total_centavos) + ' (' + r.refunded.count + ')</strong></div>' +
          '<div class="report-line total"><span>Net collected</span><strong>' +
          ui.pesos(r.net_collected_centavos) + '</strong></div>';
      } catch (err) {
        box.innerHTML = '<p class="error-text">' + ui.esc(err.message) + '</p>';
      }
    }

    async function exportPdf() {
      const btn = document.getElementById('btn-report-pdf');
      btn.disabled = true;
      try {
        const { blob, filename } = await api.salesPdf(
          document.getElementById('report-period').value,
          document.getElementById('report-anchor').value || undefined
        );
        // Blob URL download: the PDF never touches the page DOM.
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch (err) {
        window.alert(err.message || 'PDF export failed.');
      } finally {
        btn.disabled = false;
      }
    }

    document.getElementById('btn-report-view').addEventListener('click', viewReport);
    document.getElementById('btn-report-pdf').addEventListener('click', exportPdf);

    load().catch((err) => {
      document.getElementById('recent-tbody').innerHTML =
        '<tr><td colspan="5" class="error-text">' + ui.esc(err.message) + '</td></tr>';
    });
  });
})();
