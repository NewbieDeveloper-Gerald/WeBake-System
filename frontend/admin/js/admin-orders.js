/**
 * admin-orders: order pipeline + downpayment verification (legacy shell).
 *
 * WHAT: Rebuilds the status tabs to the SIX real statuses (the legacy shell
 * predates the state machine), renders the table from the admin list, and
 * wires the verify / details / balance / cancel flows to the API.
 *
 * LEGACY ADAPTATIONS (documented, not hidden):
 * - Channel filter: walk-in option removed (counter sales live on the POS
 *   page); every row here is Online.
 * - Edit modal: customer fields are READ-ONLY (orders are immutable after
 *   placement); the status dropdown carries only the LEGAL next moves and the
 *   save button performs a board transition, not an edit.
 * - Balance modal: GCash/Maya options hidden (online balances are cash-only).
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('orders-table-body')) return; // not this page

    const ui = window.AdminUI;
    const api = window.AdminAPI;

    // The six real statuses, in pipeline order (spec state machine).
    const TABS = [
      ['all', 'All Orders'],
      ['PAYMENT_UNDER_VERIFICATION', 'Under Verification'],
      ['CONFIRMED', 'Confirmed'],
      ['IN_PRODUCTION', 'In Production'],
      ['OUT_FOR_DELIVERY', 'Out for Delivery'],
      ['COMPLETED', 'Completed'],
      ['CANCELLED', 'Cancelled'],
    ];
    // Legal forward moves per status (mirrors the backend machine).
    const NEXT = {
      CONFIRMED: ['IN_PRODUCTION'],
      IN_PRODUCTION: ['OUT_FOR_DELIVERY'],
      OUT_FOR_DELIVERY: ['COMPLETED'],
    };
    const COLLECTIBLE = ['CONFIRMED', 'IN_PRODUCTION', 'OUT_FOR_DELIVERY'];
    const CANCELLABLE = ['PAYMENT_UNDER_VERIFICATION', 'CONFIRMED'];

    let orders = [];
    let queueByCode = {};
    let activeTab = 'all';
    let currentCode = null;

    // --- legacy shell adaptations ---
    (function adaptShell() {
      // Tabs: rebuild to the real machine (counts filled after load).
      const tabsBox = document.querySelector('.orders-status-tabs');
      tabsBox.innerHTML = TABS.map(([val, label], i) =>
        '<button type="button" class="order-tab-btn' + (i === 0 ? ' active' : '') +
        '" data-status="' + val + '"><span>' + label +
        '</span><span class="order-tab-count">0</span></button>').join('');
      tabsBox.addEventListener('click', (e) => {
        const btn = e.target.closest('.order-tab-btn');
        if (!btn) return;
        tabsBox.querySelectorAll('.order-tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.status;
        render();
      });
      // Channel: online only here; POS has its own page.
      const channel = document.getElementById('orders-channel-filter');
      [...channel.options].forEach((o) => { if (o.value === 'walkin') o.remove(); });
      channel.value = 'online';
      channel.disabled = true;
      // Edit modal: customer fields read-only; items read-only; save = move status.
      ['edit-cust-name', 'edit-cust-phone', 'edit-cust-email', 'edit-cust-address']
        .forEach((id) => { document.getElementById(id).readOnly = true; });
      // Balance modal: cash-only collection.
      document.querySelectorAll('input[name="balance-payment-mode"]').forEach((r) => {
        if (r.value !== 'Cash') {
          const label = r.closest('label');
          if (label) label.style.display = 'none';
        }
      });
    })();

    document.getElementById('orders-search').addEventListener('input', render);

    async function load() {
      const [list, queue] = await Promise.all([api.adminOrders(), api.verificationQueue()]);
      orders = list.orders || [];
      queueByCode = {};
      (queue.queue || []).forEach((row) => { queueByCode[row.order.order_code] = row; });
      // Tab counts.
      document.querySelectorAll('.order-tab-btn').forEach((btn) => {
        const st = btn.dataset.status;
        const n = st === 'all' ? orders.length : orders.filter((o) => o.status === st).length;
        btn.querySelector('.order-tab-count').textContent = n;
      });
      render();
    }

    function filtered() {
      const q = document.getElementById('orders-search').value.trim().toLowerCase();
      return orders.filter((o) => {
        if (activeTab !== 'all' && o.status !== activeTab) return false;
        if (!q) return true;
        return [o.order_code, o.customer_name, o.customer_contact, o.customer_email]
          .some((v) => String(v || '').toLowerCase().includes(q));
      });
    }

    function actionsFor(o) {
      const btns = [];
      if (o.status === 'PAYMENT_UNDER_VERIFICATION') {
        btns.push('<button type="button" class="btn btn-primary btn-sm" data-verify="' +
          ui.esc(o.order_code) + '">Verify</button>');
      } else {
        btns.push('<button type="button" class="btn btn-outline btn-sm" data-details="' +
          ui.esc(o.order_code) + '">Details</button>');
      }
      if (COLLECTIBLE.includes(o.status) && o.balance_due_centavos > 0) {
        btns.push('<button type="button" class="btn btn-success btn-sm" data-balance="' +
          ui.esc(o.order_code) + '">Collect</button>');
      }
      if (CANCELLABLE.includes(o.status)) {
        btns.push('<button type="button" class="btn btn-danger-outline btn-sm" data-cancel="' +
          ui.esc(o.order_code) + '">Cancel</button>');
      }
      return btns.join(' ');
    }

    function render() {
      const rows = filtered();
      document.getElementById('orders-table-body').innerHTML = rows.length ? rows.map((o) =>
        '<tr><td><strong>' + ui.esc(o.order_code) + '</strong><br><small class="muted">' +
        ui.fmtDate(o.created_at) + '</small></td><td>' + ui.esc(o.customer_name) +
        '<br><small class="muted">' + ui.esc(o.customer_contact) + '</small></td>' +
        '<td><span class="channel-pill">Online</span></td>' +
        '<td>' + (o.total_bundles || 0) + ' bundles</td>' +
        '<td><strong>' + ui.pesos(o.total_centavos) + '</strong><br><small class="muted">DP ' +
        ui.pesos(o.downpayment_paid_centavos) + '</small></td>' +
        '<td>' + ui.esc(o.payment_method || '-') + '</td>' +
        '<td>' + ui.pill(o.status) + '</td>' +
        '<td class="actions-cell">' + actionsFor(o) + '</td></tr>'
      ).join('') : '<tr><td colspan="8" class="muted">No orders match.</td></tr>';
    }

    // --- table actions (delegated) ---
    document.getElementById('orders-table-body').addEventListener('click', async (e) => {
      const v = e.target.closest('[data-verify]');
      const d = e.target.closest('[data-details]');
      const b = e.target.closest('[data-balance]');
      const c = e.target.closest('[data-cancel]');
      try {
        if (v) { openVerify(v.dataset.verify); return; }
        if (d) { await openDetails(d.dataset.details); return; }
        if (b) { openBalance(b.dataset.balance); return; }
        if (c) {
          const reason = window.prompt('Cancel ' + c.dataset.cancel + '? Type the reason (min 5 characters):');
          if (!reason) return;
          await api.cancelOrder(c.dataset.cancel, reason);
          window.alert('Order cancelled. The customer was emailed about the refund.');
          await load();
        }
      } catch (err) {
        window.alert(err.message);
      }
    });

    // --- verify modal ---
    function openVerify(code) {
      const row = queueByCode[code];
      if (!row) { window.alert('This order is no longer awaiting verification.'); load(); return; }
      currentCode = code;
      const { order: o, payment: p } = row;
      set('verify-order-id', o.order_code);
      set('verify-cust-name', o.customer_name);
      set('verify-cust-contact', o.customer_contact);
      set('verify-cust-address', o.delivery_address);
      set('verify-order-total', ui.pesos(o.total_centavos));
      set('verify-downpayment-amt', ui.pesos(o.downpayment_centavos));
      set('verify-balance-amt', ui.pesos(o.balance_due_centavos));
      set('verify-payment-method', p.channel);
      set('verify-ref-number', p.reference_number);
      const img = document.getElementById('verify-proof-image');
      const none = document.getElementById('verify-no-proof');
      if (row.proof_url) {
        img.src = row.proof_url; img.style.display = ''; none.style.display = 'none';
      } else {
        img.style.display = 'none'; none.style.display = '';
      }
      document.getElementById('verify-rejection-box').classList.remove('active');
      document.getElementById('verify-rejection-reason').value = '';
      document.getElementById('modal-verify-payment').classList.add('active');
    }

    document.getElementById('btn-close-verify').addEventListener('click', () => {
      document.getElementById('modal-verify-payment').classList.remove('active');
    });
    document.getElementById('btn-show-reject-form').addEventListener('click', () => {
      document.getElementById('verify-rejection-box').classList.add('active');
    });

    document.getElementById('btn-approve-downpayment').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.approvePayment(currentCode);
        document.getElementById('modal-verify-payment').classList.remove('active');
        window.alert(currentCode + ' verified and Confirmed. The customer was emailed.');
        await load();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('btn-confirm-reject').addEventListener('click', async (e) => {
      const reason = document.getElementById('verify-rejection-reason').value.trim();
      if (reason.length < 5) { window.alert('Please type a rejection reason (min 5 characters).'); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await api.rejectPayment(currentCode, reason);
        document.getElementById('modal-verify-payment').classList.remove('active');
        window.alert(res.resubmit_allowed
          ? 'Rejected. The customer may correct and resubmit once.'
          : 'Rejected. Order cancelled; the customer was emailed about the refund.');
        await load();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    // Proof lightbox.
    document.getElementById('verify-proof-image').addEventListener('click', (e) => {
      document.getElementById('lightbox-full-img').src = e.currentTarget.src;
      document.getElementById('modal-proof-lightbox').classList.add('active');
    });
    document.getElementById('btn-close-lightbox').addEventListener('click', () => {
      document.getElementById('modal-proof-lightbox').classList.remove('active');
    });

    // --- details modal (read-only + legal status moves) ---
    async function openDetails(code) {
      const { order: o } = await api.orderDetail(code);
      currentCode = code;
      set('edit-order-id-label', o.order_code);
      document.getElementById('edit-cust-name').value = o.customer_name || '';
      document.getElementById('edit-cust-phone').value = o.customer_contact || '';
      document.getElementById('edit-cust-email').value = o.customer_email || '';
      document.getElementById('edit-cust-address').value = o.delivery_address || '';
      document.getElementById('edit-items-tbody').innerHTML = (o.items || []).map((it) =>
        '<tr><td>' + ui.esc(it.product_name) + '</td><td>' + ui.pesos(it.unit_price_centavos) +
        '</td><td>' + it.bundles + '</td><td class="text-right">' +
        ui.pesos(it.line_total_centavos) + '</td></tr>').join('');
      set('edit-calculated-total', ui.pesos(o.total_centavos));
      set('edit-calculated-downpayment', ui.pesos(o.downpayment_centavos));
      set('edit-calculated-balance', ui.pesos(o.balance_due_centavos));
      // Status dropdown: current + legal nexts only (anything else 409s anyway).
      const sel = document.getElementById('edit-order-status-select');
      const moves = [o.status, ...(NEXT[o.status] || [])];
      sel.innerHTML = moves.map((s) =>
        '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' +
        ui.esc(s.replace(/_/g, ' ').toLowerCase()) + '</option>').join('');
      updateSaveLabel();
      document.getElementById('modal-edit-order').classList.add('active');
    }

    function updateSaveLabel() {
      const sel = document.getElementById('edit-order-status-select');
      const btn = document.getElementById('btn-save-edit-order');
      const current = sel.options[0].value;
      btn.innerHTML = sel.value === current
        ? 'No status change'
        : '<i class="fas fa-arrow-right"></i> Move to ' + ui.esc(sel.value.replace(/_/g, ' ').toLowerCase());
      btn.disabled = sel.value === current;
    }

    document.getElementById('edit-order-status-select').addEventListener('change', updateSaveLabel);
    document.getElementById('btn-close-edit').addEventListener('click', () => {
      document.getElementById('modal-edit-order').classList.remove('active');
    });
    document.getElementById('btn-save-edit-order').addEventListener('click', async (e) => {
      const to = document.getElementById('edit-order-status-select').value;
      if (!ui.confirmAsk('Move ' + currentCode + ' to ' + to + '?')) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.transitionOrder(currentCode, to);
        document.getElementById('modal-edit-order').classList.remove('active');
        await load();
      } catch (err) {
        window.alert(err.message);
        btn.disabled = false;
      }
    });

    // --- balance modal (cash only) ---
    function openBalance(code) {
      const o = orders.find((x) => x.order_code === code);
      if (!o) return;
      currentCode = code;
      set('balance-order-id', o.order_code);
      set('balance-cust-name', o.customer_name);
      set('balance-due-amount', ui.pesos(o.balance_due_centavos));
      // The API records money only; completion is a separate board move (the
      // transition rejects COMPLETED while a balance is outstanding).
      document.getElementById('btn-confirm-balance').innerHTML =
        '<i class="fas fa-check-double"></i> Confirm Cash Collected';
      document.getElementById('modal-collect-balance').classList.add('active');
    }

    document.getElementById('btn-close-balance').addEventListener('click', () => {
      document.getElementById('modal-collect-balance').classList.remove('active');
    });
    document.getElementById('btn-confirm-balance').addEventListener('click', async (e) => {
      if (!ui.confirmAsk('Record cash collection for ' + currentCode + '? Move it to Completed on the board afterwards.')) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.recordBalance(currentCode, 'Cash collected on handover');
        document.getElementById('modal-collect-balance').classList.remove('active');
        window.alert('Balance recorded. You can now move the order to Completed.');
        await load();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    function set(id, text) {
      document.getElementById(id).textContent = text;
    }

    load().catch((err) => {
      document.getElementById('orders-table-body').innerHTML =
        '<tr><td colspan="8" class="error-text">' + ui.esc(err.message) + '</td></tr>';
    });
  });
})();
