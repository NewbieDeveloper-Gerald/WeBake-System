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
        return '<a href="walkin-pos.html" class="btn btn-outline btn-sm"><i class="fas fa-receipt"></i> POS Counter</a>';
      }
      const btns = [];
      if (o.status === 'PAYMENT_UNDER_VERIFICATION') {
        const hasProof = !!queueByCode[o.order_code];
        btns.push('<button type="button" class="btn ' + (hasProof ? 'btn-primary' : 'btn-outline') + ' btn-sm" data-verify="' +
          ui.esc(o.order_code) + '">' + (hasProof ? 'Verify Payment' : 'Awaiting Proof') + '</button>');
        btns.push('<button type="button" class="btn btn-outline btn-sm" data-details="' +
          ui.esc(o.order_code) + '">Details</button>');
      } else {
        btns.push('<button type="button" class="btn btn-outline btn-sm" data-details="' +
          ui.esc(o.order_code) + '">Details</button>');
      }
      if (o.status === 'OUT_FOR_DELIVERY' && o.balance_due_centavos > 0) {
        const maxPesos = (o.balance_due_centavos / 100).toFixed(2);
        btns.push(
          '<div class="collect-inline-box" style="display:inline-flex; align-items:center; gap:4px; margin-top:4px;">' +
            '<div style="position:relative; display:inline-block;">' +
              '<span style="position:absolute; left:6px; top:50%; transform:translateY(-50%); font-size:0.75rem; color:#888;">₱</span>' +
              '<input type="number" step="0.01" min="0.01" max="' + maxPesos + '" value="' + maxPesos + '" ' +
                     'class="form-input collect-input" id="col-input-' + ui.esc(o.order_code) + '" ' +
                     'data-max-cents="' + o.balance_due_centavos + '" ' +
                     'style="width:85px; padding:2px 4px 2px 18px; font-size:0.78rem; height:28px; border:1px solid #d0c5bc; border-radius:6px;" ' +
                     'placeholder="Amount" title="Remaining: ₱' + maxPesos + '">' +
            '</div>' +
            '<button type="button" class="btn btn-success btn-sm" style="padding:2px 8px; font-size:0.78rem; height:28px;" ' +
                    'data-collect-confirm="' + ui.esc(o.order_code) + '">' +
              '<i class="fas fa-check"></i> Collect' +
            '</button>' +
          '</div>'
        );
      }
      if (CANCELLABLE.includes(o.status)) {
        btns.push('<button type="button" class="btn btn-danger-outline btn-sm" data-cancel="' +
          ui.esc(o.order_code) + '">Cancel</button>');
      }
      return btns.join(' ');
    }

    function render() {
      const rows = filtered();
      document.getElementById('orders-table-body').innerHTML = rows.length ? rows.map((o) => {
        const isPaid = (o.downpayment_paid_centavos || 0) > 0;
        const amountPaid = o.amount_paid_centavos != null
          ? o.amount_paid_centavos
          : (isPaid ? (o.total_centavos - (o.balance_due_centavos || 0)) : 0);
        const remBalance = o.balance_due_centavos != null ? o.balance_due_centavos : 0;
        let payStatus = o.payment_status;
        if (!payStatus) {
          if (o.status === 'CANCELLED') payStatus = 'Cancelled';
          else if (remBalance === 0 && (isPaid || o.is_walkin)) payStatus = 'Fully Paid';
          else if (isPaid) payStatus = 'Partially Paid';
          else payStatus = 'Pending Verification';
        }
        const payPillStyle = payStatus === 'Fully Paid'
          ? 'background:#dcfce7; color:#15803d; border:1px solid #86efac;'
          : payStatus === 'Partially Paid'
            ? 'background:#fef3c7; color:#b45309; border:1px solid #fde68a;'
            : payStatus === 'Cancelled'
              ? 'background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;'
              : 'background:#f3f4f6; color:#4b5563; border:1px solid #e5e7eb;';

        return '<tr><td><strong>' + ui.esc(o.order_code) + '</strong><br><small class="muted">' +
          ui.fmtDate(o.created_at) + '</small></td><td>' + ui.esc(o.customer_name) +
          '<br><small class="muted">' + ui.esc(o.customer_contact) + '</small></td>' +
          '<td>' + (o.is_walkin ? '<span class="channel-pill" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;"><i class="fas fa-store"></i> Walk-In</span>' : '<span class="channel-pill">Online</span>') + '</td>' +
          '<td>' + (o.is_walkin ? 'Counter Piece/Bdl' : (o.total_bundles || 0) + ' bundles') + '</td>' +
          '<td>' +
            '<div style="line-height:1.35;">' +
              '<div><strong>Total: </strong>' + ui.pesos(o.total_centavos) + '</div>' +
              '<div><small style="color:#15803d; font-weight:600;">Paid: ' + ui.pesos(amountPaid) + '</small></div>' +
              '<div><small style="color:' + (remBalance > 0 ? '#b45309' : '#6b7280') + '; font-weight:600;">Balance: ' + ui.pesos(remBalance) + '</small></div>' +
              '<div style="margin-top:3px;"><span style="display:inline-block; font-size:0.7rem; font-weight:700; padding:1px 6px; border-radius:4px; ' + payPillStyle + '">' +
                ui.esc(payStatus) +
              '</span></div>' +
            '</div>' +
          '</td>' +
          '<td>' + ui.esc(o.payment_method || '-') + '</td>' +
          '<td>' + ui.pill(o.status) + '</td>' +
          '<td class="actions-cell">' + actionsFor(o) + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted">No orders match.</td></tr>';
    }

    // --- table actions (delegated) ---
    document.getElementById('orders-table-body').addEventListener('click', async (e) => {
      const v = e.target.closest('[data-verify]');
      const d = e.target.closest('[data-details]');
      const b = e.target.closest('[data-balance]');
      const c = e.target.closest('[data-cancel]');
      const colBtn = e.target.closest('[data-collect-confirm]');
      try {
        if (colBtn) {
          const code = colBtn.dataset.collectConfirm;
          const input = document.getElementById('col-input-' + code);
          const maxCents = input ? Number(input.dataset.maxCents || 0) : 0;
          const enteredVal = input ? parseFloat(input.value) : 0;
          if (!enteredVal || isNaN(enteredVal) || enteredVal <= 0) {
            window.alert('Please enter a valid amount to collect.');
            return;
          }
          const enteredCents = Math.round(enteredVal * 100);
          if (enteredCents > maxCents) {
            window.alert('Cannot collect more than the remaining balance of ' + ui.pesos(maxCents) + '.');
            return;
          }
          if (!ui.confirmAsk('Confirm collection of ' + ui.pesos(enteredCents) + ' for order ' + code + '?')) return;
          colBtn.disabled = true;
          try {
            const res = await api.recordBalance(code, 'Collected on delivery', enteredCents);
            window.alert('Collection successful! Amount paid: ' + ui.pesos(res.amount_paid_centavos) + '. Remaining balance: ' + ui.pesos(res.balance_due_centavos) + ' (' + res.payment_status + ').');
            await load();
          } finally {
            colBtn.disabled = false;
          }
          return;
        }
        if (v) { openVerify(v.dataset.verify); return; }
        if (d) { await openDetails(d.dataset.details); return; }
        if (b) { openBalance(b.dataset.balance); return; }
        if (c) {
          const reason = window.prompt('Cancel ' + c.dataset.cancel + '? Type the reason (min 5 characters):');
          if (!reason) return;
          if (reason.trim().length < 5) {
            window.alert('Cancellation reason must be at least 5 characters.');
            return;
          }
          await api.cancelOrder(c.dataset.cancel, reason.trim());
          window.alert('Order cancelled.');
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
