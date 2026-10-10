/**
 * admin-refunds: refund queue (legacy shell).
 *
 * WHAT: Renders the queue with wallet + status, records manual payouts
 * (money moves OUTSIDE the system; the admin records it here), and closes
 * requests with a required note. AWAITING rows wait on the CUSTOMER's wallet
 * details (submitted via the emailed link), so the admin can only close them.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('refunds-table-body')) return; // not this page

    const ui = window.AdminUI;
    const api = window.AdminAPI;
    let rows = [];
    let currentId = null;
    let activeTab = 'pending';

    // Wire refund status tabs
    document.querySelectorAll('.orders-status-tabs .order-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.orders-status-tabs .order-tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab || 'pending';
        render();
      });
    });

    async function load() {
      const data = await api.refundsQueue();
      rows = data.refunds || [];
      const counts = data.byStatus || {};
      set('count-refund-pending',
        String((counts.AWAITING_DETAILS || 0) + (counts.PENDING || 0)));
      set('count-refund-approved', String(counts.REFUNDED || 0));
      set('count-refund-declined', String(counts.CLOSED_NO_PAYMENT || 0));
      render();
    }

    function walletText(r) {
      if (r.status === 'AWAITING_DETAILS') return '<span class="muted">waiting on customer</span>';
      return ui.esc(r.wallet_type || '-') + '<br><small class="muted">' +
        ui.esc(r.account_number || '') + ' / ' + ui.esc(r.account_name || '') + '</small>';
    }

    function actionsFor(r) {
      if (r.status === 'PENDING') {
        return '<button type="button" class="btn btn-success btn-sm" data-payout="' + r.id + '"><i class="fas fa-money-bill-transfer"></i> Record payout</button> ' +
          '<button type="button" class="btn btn-outline btn-sm" data-close="' + r.id + '">Close</button>';
      }
      if (r.status === 'AWAITING_DETAILS') {
        return '<button type="button" class="btn btn-outline btn-sm" data-close="' + r.id + '">Close</button>';
      }
      return '<span class="muted">-</span>';
    }

    function render() {
      const filtered = rows.filter((r) => {
        if (activeTab === 'approved') return r.status === 'REFUNDED';
        if (activeTab === 'declined') return r.status === 'CLOSED_NO_PAYMENT';
        return r.status === 'PENDING' || r.status === 'AWAITING_DETAILS';
      });

      const emptyMsg = activeTab === 'approved'
        ? 'No approved and refunded requests.'
        : activeTab === 'declined'
          ? 'No declined requests.'
          : 'No pending refund requests.';

      document.getElementById('refunds-table-body').innerHTML = filtered.length ? filtered.map((r) =>
        '<tr><td><strong>' + ui.esc(r.order_code) + '</strong><br><small class="muted">' +
        ui.fmtDate(r.requested_at) + '</small></td><td>' + ui.esc(r.customer_name) + '</td><td>' +
        ui.pesos(r.refund_amount_centavos) + '</td><td>' + ui.esc(r.reason || '-') + '</td><td>' +
        walletText(r) + '</td><td>' + ui.pill(r.status) + '</td>' +
        '<td class="actions-cell">' + actionsFor(r) + '</td></tr>'
      ).join('') : '<tr><td colspan="7" class="muted text-center" style="padding:2rem;">' + emptyMsg + '</td></tr>';
    }

    document.getElementById('refunds-table-body').addEventListener('click', (e) => {
      const p = e.target.closest('[data-payout]');
      const c = e.target.closest('[data-close]');
      if (p) openPayout(p.dataset.payout);
      if (c) openClose(c.dataset.close);
    });

    // --- payout modal (PENDING only): send money manually, then record it ---
    function openPayout(id) {
      const r = rows.find((x) => String(x.id) === String(id));
      if (!r) return;
      currentId = id;
      set('refund-modal-order-id', r.order_code);
      set('refund-modal-amount', ui.pesos(r.refund_amount_centavos));
      set('refund-modal-wallet', r.wallet_type || '-');
      set('refund-modal-acc-num', r.account_number || '-');
      set('refund-modal-acc-name', r.account_name || '-');
      document.getElementById('refund-payout-ref').value = '';
      document.getElementById('modal-process-refund').classList.add('active');
    }

    document.getElementById('btn-close-process').addEventListener('click', () => {
      document.getElementById('modal-process-refund').classList.remove('active');
    });
    document.getElementById('btn-confirm-payout').addEventListener('click', async (e) => {
      const ref = document.getElementById('refund-payout-ref').value.trim();
      if (!ui.confirmAsk('Confirm the money was SENT to the customer? This marks the refund paid.')) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.markRefunded(currentId, ref, 'Payout recorded in admin panel');
        document.getElementById('modal-process-refund').classList.remove('active');
        window.alert('Refund marked as paid. The customer was emailed.');
        await load();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    // --- close modal: no money moves; the note goes to the customer email ---
    function openClose(id) {
      const r = rows.find((x) => String(x.id) === String(id));
      if (!r) return;
      currentId = id;
      set('decline-modal-order-id', r.order_code);
      document.getElementById('decline-reason-text').value = '';
      document.getElementById('modal-decline-refund').classList.add('active');
    }

    document.getElementById('btn-close-decline').addEventListener('click', () => {
      document.getElementById('modal-decline-refund').classList.remove('active');
    });
    document.getElementById('btn-confirm-decline').addEventListener('click', async (e) => {
      const note = document.getElementById('decline-reason-text').value.trim();
      if (note.length < 5) { window.alert('A note is required (min 5 characters) - the customer reads it.'); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.refundClose(currentId, note);
        document.getElementById('modal-decline-refund').classList.remove('active');
        window.alert('Refund closed. The customer was emailed.');
        await load();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    function set(id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    }

    load().catch((err) => {
      document.getElementById('refunds-table-body').innerHTML =
        '<tr><td colspan="7" class="error-text">' + ui.esc(err.message) + '</td></tr>';
    });
  });
})();
