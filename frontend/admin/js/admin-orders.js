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
    const CANCELLABLE = ['PAYMENT_UNDER_VERIFICATION'];

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
      // Channel filter: active and working
      const channel = document.getElementById('orders-channel-filter');
      if (channel) {
        channel.value = 'all';
        channel.disabled = false;
        channel.addEventListener('change', render);
      }
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

    let walkinSales = [];

    async function load() {
      const [list, queue, posRes] = await Promise.all([
        api.adminOrders(),
        api.verificationQueue(),
        api.posRecent(100).catch(() => ({ sales: [] })),
      ]);
      orders = list.orders || [];
      const rawWalkins = posRes.sales || posRes.recent || [];
      walkinSales = rawWalkins.map((w) => Object.assign({}, w, {
        is_walkin: true,
        order_code: w.receipt_number,
        customer_name: w.customer_name || 'Walk-In Customer',
        customer_contact: '-',
        customer_email: '',
        total_bundles: 0,
        downpayment_paid_centavos: w.total_centavos,
        balance_due_centavos: 0,
        status: 'COMPLETED',
      }));
      queueByCode = {};
      (queue.queue || []).forEach((row) => { queueByCode[row.order.order_code] = row; });
      // Tab counts.
      document.querySelectorAll('.order-tab-btn').forEach((btn) => {
        const st = btn.dataset.status;
        const onlineCount = st === 'all' ? orders.length : orders.filter((o) => o.status === st).length;
        const walkinCount = (st === 'all' || st === 'COMPLETED') ? walkinSales.length : 0;
        btn.querySelector('.order-tab-count').textContent = onlineCount + walkinCount;
      });
      render();
    }

    function filtered() {
      const q = document.getElementById('orders-search').value.trim().toLowerCase();
      const channelEl = document.getElementById('orders-channel-filter');
      const channelMode = channelEl ? channelEl.value : 'all';

      let combined = [];
      if (channelMode === 'online') {
        combined = orders;
      } else if (channelMode === 'walkin') {
        combined = walkinSales;
      } else {
        combined = [...orders, ...walkinSales].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      return combined.filter((o) => {
        if (activeTab !== 'all' && o.status !== activeTab) return false;
        if (!q) return true;
        return [o.order_code, o.customer_name, o.customer_contact, o.customer_email]
          .some((v) => String(v || '').toLowerCase().includes(q));
      });
    }

    function actionsFor(o) {
      if (o.is_walkin) {
        return '<div class="actions-btn-group"><a href="walkin-pos.html" class="btn btn-outline btn-sm"><i class="fas fa-receipt"></i> POS Counter</a></div>';
      }
      const btns = [];

      // Primary Action based on state
      if (o.status === 'PAYMENT_UNDER_VERIFICATION') {
        const hasProof = !!queueByCode[o.order_code];
        if (hasProof) {
          btns.push('<button type="button" class="btn btn-primary btn-sm" data-verify="' +
            ui.esc(o.order_code) + '"><i class="fas fa-shield-alt"></i> Verify</button>');
        } else {
          btns.push('<span class="badge-awaiting-proof" title="Waiting for customer to upload receipt"><i class="far fa-clock"></i> Awaiting Proof</span>');
        }
      } else if (o.status === 'OUT_FOR_DELIVERY' && (o.balance_due_centavos || 0) > 0) {
        btns.push('<button type="button" class="btn btn-success btn-sm" data-balance="' +
          ui.esc(o.order_code) + '"><i class="fas fa-hand-holding-dollar"></i> Collect</button>');
      }

      // Secondary Action: Details
      btns.push('<button type="button" class="btn btn-outline btn-sm" data-details="' +
        ui.esc(o.order_code) + '"><i class="fas fa-eye"></i> Details</button>');

      // Destructive Action: Cancel (only when legally cancellable)
      if (CANCELLABLE.includes(o.status)) {
        btns.push('<button type="button" class="btn btn-danger-outline btn-sm" data-cancel="' +
          ui.esc(o.order_code) + '" title="Cancel order"><i class="fas fa-ban"></i> Cancel</button>');
      }

      return '<div class="actions-btn-group">' + btns.join('') + '</div>';
    }

    function render() {
      const rows = filtered();
      const tbody = document.getElementById('orders-table-body');
      if (!tbody) return;

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty-notice"><i class="fas fa-clipboard-list"></i><p>No orders match the selected filter.</p></td></tr>';
        return;
      }

      tbody.innerHTML = rows.map((o) => {
        const isPaid = (o.downpayment_paid_centavos || 0) > 0;
        const amountPaid = o.amount_paid_centavos != null
          ? o.amount_paid_centavos
          : (isPaid ? (o.total_centavos - (o.balance_due_centavos || 0)) : 0);
        const remBalance = o.balance_due_centavos != null ? o.balance_due_centavos : 0;
        const method = o.payment_method || (o.is_walkin ? 'CASH' : 'GCASH');

        // Financial status subtext
        let financeSub = '';
        if (o.status === 'CANCELLED') {
          financeSub = '<span class="finance-status-pill finance-cancelled">Cancelled</span>';
        } else if (remBalance <= 0) {
          financeSub = '<span class="finance-status-pill finance-paid"><i class="fas fa-check-circle"></i> Paid in Full</span>';
        } else {
          financeSub = '<span class="finance-paid-amt">Paid: ' + ui.pesos(amountPaid) + '</span> &bull; <span class="finance-bal-amt">Bal: ' + ui.pesos(remBalance) + '</span>';
        }

        const channelBadge = o.is_walkin
          ? '<span class="channel-pill channel-pill--walkin"><i class="fas fa-store"></i> Walk-In</span>'
          : '<span class="channel-pill channel-pill--online"><i class="fas fa-globe"></i> Online</span>';

        return '<tr>' +
          '<td>' +
            '<div class="order-code-text">#' + ui.esc(o.order_code) + '</div>' +
            '<div class="order-date-text">' + ui.fmtDate(o.created_at) + '</div>' +
            '<div class="order-channel-box">' + channelBadge + '</div>' +
          '</td>' +
          '<td>' +
            '<div class="order-customer-name">' + ui.esc(o.customer_name) + '</div>' +
            '<div class="order-customer-contact">' + ui.esc(o.customer_contact || '—') + '</div>' +
          '</td>' +
          '<td>' +
            '<div class="order-items-text">' + (o.is_walkin ? 'Counter Sale' : '<strong>' + (o.total_bundles || 0) + '</strong> bundles') + '</div>' +
          '</td>' +
          '<td>' +
            '<div class="order-financials-block">' +
              '<div class="order-total-row">' +
                '<strong>' + ui.pesos(o.total_centavos) + '</strong>' +
                '<span class="badge-payment-method">' + ui.esc(method) + '</span>' +
              '</div>' +
              '<div class="order-finance-sub">' + financeSub + '</div>' +
            '</div>' +
          '</td>' +
          '<td>' + ui.pill(o.status) + '</td>' +
          '<td class="actions-cell">' + actionsFor(o) + '</td>' +
        '</tr>';
      }).join('');
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
          const code = c.dataset.cancel;
          const reasons = [
            'Customer requested cancellation',
            'Out of stock / ingredients unavailable',
            'Delivery address unreachable or out of delivery zone',
            'Payment verification failed / unpaid',
            'Duplicate order entry by mistake',
            'Other',
          ];
          const choice = window.prompt(
            'Cancel order ' + code + '?\n\nSelect a reason by number:\n' +
            reasons.map((r, i) => (i + 1) + '. ' + r).join('\n') +
            '\n\nEnter number (1-' + reasons.length + ') or type specific reason:'
          );
          if (!choice) return;
          let fullReason = '';
          const idx = parseInt(choice.trim(), 10) - 1;
          if (!isNaN(idx) && idx >= 0 && idx < reasons.length) {
            if (reasons[idx] === 'Other') {
              const spec = window.prompt('Please type the specific cancellation reason (min 5 characters):');
              if (!spec || spec.trim().length < 5) {
                window.alert('Cancellation reason must be at least 5 characters.');
                return;
              }
              fullReason = spec.trim();
            } else {
              fullReason = reasons[idx];
            }
          } else if (choice.trim().length >= 5) {
            fullReason = choice.trim();
          } else {
            window.alert('Please select a valid option or type a reason with at least 5 characters.');
            return;
          }
          await api.cancelOrder(code, fullReason);
          window.alert('Order ' + code + ' cancelled.');
          await load();
        }
      } catch (err) {
        window.alert(err.message);
      }
    });

    // --- verify modal ---
    function openVerify(code) {
      const row = queueByCode[code];
      const o = row ? row.order : orders.find((x) => x.order_code === code);
      if (!o) { window.alert('Order not found.'); load(); return; }
      currentCode = code;
      const p = row ? row.payment : {
        channel: o.payment_method || 'GCASH',
        reference_number: '(None submitted yet)',
      };
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
      if (row && row.proof_url) {
        img.src = row.proof_url; img.style.display = ''; none.style.display = 'none';
      } else {
        img.style.display = 'none'; none.style.display = '';
        const msgEl = none.querySelector('p');
        if (msgEl) {
          msgEl.textContent = row
            ? 'No screenshot attached for this transaction.'
            : 'Customer placed order but has not uploaded payment proof yet.';
        }
      }
      document.getElementById('verify-rejection-box').classList.remove('active');
      const rejSelect = document.getElementById('verify-rejection-select');
      if (rejSelect) rejSelect.value = '';
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
        try { localStorage.setItem('webake_sale_updated', Date.now()); } catch {}
        await load();
      } catch (err) {
        window.alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('btn-confirm-reject').addEventListener('click', async (e) => {
      const sel = document.getElementById('verify-rejection-select');
      const selected = sel ? sel.value : '';
      const note = document.getElementById('verify-rejection-reason').value.trim();
      if (!selected) {
        window.alert('Please select a rejection reason.');
        return;
      }
      let fullReason = selected;
      if (selected === 'Other') {
        if (!note || note.length < 5) {
          window.alert('Please specify the rejection reason (minimum 5 characters).');
          return;
        }
        fullReason = note;
      } else if (note) {
        fullReason = selected + ': ' + note;
      }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await api.rejectPayment(currentCode, fullReason);
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

    // --- balance modal ---
    function openBalance(code) {
      const o = orders.find((x) => x.order_code === code);
      if (!o) return;
      if (o.status !== 'OUT_FOR_DELIVERY') {
        window.alert('Balance collection is only available when order is Out for Delivery.');
        return;
      }
      currentCode = code;
      const maxPesos = (o.balance_due_centavos / 100).toFixed(2);
      set('balance-order-id', o.order_code);
      set('balance-cust-name', o.customer_name);
      set('balance-due-amount', ui.pesos(o.balance_due_centavos));
      const input = document.getElementById('balance-collect-input');
      if (input) {
        input.value = maxPesos;
        input.max = maxPesos;
        input.dataset.maxCents = o.balance_due_centavos;
      }
      document.getElementById('btn-confirm-balance').innerHTML =
        '<i class="fas fa-check-double"></i> Confirm Balance Collected';
      document.getElementById('modal-collect-balance').classList.add('active');
    }

    document.getElementById('btn-close-balance').addEventListener('click', () => {
      document.getElementById('modal-collect-balance').classList.remove('active');
    });
    document.getElementById('btn-confirm-balance').addEventListener('click', async (e) => {
      const o = orders.find((x) => x.order_code === currentCode);
      const input = document.getElementById('balance-collect-input');
      const maxCents = (o && o.balance_due_centavos) || (input ? Number(input.dataset.maxCents || 0) : 0);
      const enteredVal = input ? parseFloat(input.value) : (maxCents / 100);
      if (!enteredVal || isNaN(enteredVal) || enteredVal <= 0) {
        window.alert('Please enter a valid amount to collect.');
        return;
      }
      const enteredCents = Math.round(enteredVal * 100);
      if (enteredCents > maxCents) {
        window.alert('Cannot collect more than the remaining balance of ' + ui.pesos(maxCents) + '.');
        return;
      }
      if (!ui.confirmAsk('Record collection of ' + ui.pesos(enteredCents) + ' for ' + currentCode + '?')) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await api.recordBalance(currentCode, 'Cash collected on handover', enteredCents);
        document.getElementById('modal-collect-balance').classList.remove('active');
        window.alert('Collection successful! Amount paid: ' + ui.pesos(res.amount_paid_centavos) + '. Remaining balance: ' + ui.pesos(res.balance_due_centavos) + ' (' + res.payment_status + ').');
        try { localStorage.setItem('webake_sale_updated', Date.now()); } catch {}
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
        '<tr><td colspan="6" class="error-text">' + ui.esc(err.message) + '</td></tr>';
    });
  });
})();
