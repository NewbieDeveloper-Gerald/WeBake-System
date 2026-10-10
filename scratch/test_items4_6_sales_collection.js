'use strict';

const assert = require('assert');
const { query } = require('../backend/src/config/db');

const BASE_URL = 'http://localhost:5000/api';

async function req(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

(async () => {
  console.log('--- Testing Item 4 (Sales Today Combined) and Item 6 (Order Balance Collection) ---');

  // 1. Admin auth
  const { signAdminToken } = require('../backend/src/utils/jwt');
  const adminToken = signAdminToken({ id: 1, email: 'crbwebake@gmail.com' });
  const authHeaders = { Authorization: `Bearer ${adminToken}` };
  console.log('✓ 1. Admin authenticated via signed token');

  // 2. Check dashboard stats schema
  const statsRes = await req('/admin/reports/dashboard', { headers: authHeaders });
  assert.strictEqual(statsRes.status, 200, 'Failed to fetch dashboard stats');
  const salesToday = statsRes.data.stats.sales_today;
  assert(salesToday !== undefined, 'sales_today missing in dashboard stats');
  assert(typeof salesToday.combined_centavos === 'number', 'combined_centavos must be a number');
  assert(typeof salesToday.online_collected_centavos === 'number', 'online_collected_centavos must be a number');
  assert(typeof salesToday.walkin_gross_centavos === 'number', 'walkin_gross_centavos must be a number');
  assert.strictEqual(
    salesToday.combined_centavos,
    salesToday.online_collected_centavos + salesToday.walkin_gross_centavos,
    'combined_centavos must equal online_collected_centavos + walkin_gross_centavos'
  );
  console.log('✓ 2. Dashboard stats returns combined sales correctly:', salesToday);

  // 3. Test balance collection validations on orders
  // Create a clean test order in DB
  const testOrderCode = 'TEST-ORD-' + Date.now().toString().slice(-6);
  await query(
    `INSERT INTO orders (
      order_code, customer_name, customer_email, customer_contact,
      delivery_address, subtotal_centavos, total_centavos, downpayment_centavos,
      downpayment_paid_centavos, balance_due_centavos,
      payment_method, status, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      testOrderCode,
      'Test Juan',
      'testjuan@example.com',
      '09123456789',
      '123 Bulacan St',
      3150000,
      3150000, // 31,500.00
      1575000, // 15,750.00 downpayment
      1575000, // 15,750.00 downpayment_paid_centavos
      1575000, // 15,750.00 balance due
      'GCASH',
      'CONFIRMED', // NOT OUT_FOR_DELIVERY yet
      'Test order for balance collection'
    ]
  );
  console.log(`Created test order ${testOrderCode} in status CONFIRMED`);

  try {
    // 3a. Reject balance collection when status is not OUT_FOR_DELIVERY
    const notDueRes = await req(`/admin/orders/${testOrderCode}/record-balance`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ amount_centavos: 100000 })
    });
    assert.strictEqual(notDueRes.status, 409, 'Expected 409 when order is not OUT_FOR_DELIVERY');
    assert.strictEqual(notDueRes.data.code, 'BALANCE_NOT_DUE');
    console.log('✓ 3a. Rejected collection when status is not OUT_FOR_DELIVERY');

    // 3b. Advance order to OUT_FOR_DELIVERY
    await query('UPDATE orders SET status = $1 WHERE order_code = $2', ['OUT_FOR_DELIVERY', testOrderCode]);

    // 3c. Reject overpayment
    const overpayRes = await req(`/admin/orders/${testOrderCode}/record-balance`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ amount_centavos: 2000000 }) // 20,000 > 15,750
    });
    assert.strictEqual(overpayRes.status, 409, 'Expected 409 for overpayment');
    assert.strictEqual(overpayRes.data.code, 'OVERPAYMENT_NOT_ALLOWED');
    console.log('✓ 3b. Rejected overpayment amount above balance due');

    // 3d. Reject non-positive or invalid amounts
    const invalidAmtRes = await req(`/admin/orders/${testOrderCode}/record-balance`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ amount_centavos: 0 })
    });
    assert.strictEqual(invalidAmtRes.status, 400, 'Expected 400 for amount <= 0');
    console.log('✓ 3c. Rejected invalid/zero amount');

    // 3e. Test partial collection
    const partialAmount = 575000; // 5,750.00 collected
    const initialStats = (await req('/admin/reports/dashboard', { headers: authHeaders })).data.stats.sales_today;

    const partialRes = await req(`/admin/orders/${testOrderCode}/record-balance`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ amount_centavos: partialAmount })
    });
    assert.strictEqual(partialRes.status, 200, `Partial collection failed: ${JSON.stringify(partialRes.data)}`);
    assert.strictEqual(partialRes.data.balance_due_centavos, 1000000, 'Remaining balance should be 10,000.00');
    assert.strictEqual(partialRes.data.amount_paid_centavos, 2150000, 'Total amount paid should be 21,500.00');
    assert.strictEqual(partialRes.data.payment_status, 'Partially Paid', 'Payment status should be Partially Paid');
    console.log('✓ 3d. Partial collection succeeded, remaining balance and status updated');

    // Check dashboard sales today immediately reflected this collection
    const afterPartialStats = (await req('/admin/reports/dashboard', { headers: authHeaders })).data.stats.sales_today;
    assert.strictEqual(
      afterPartialStats.online_collected_centavos,
      initialStats.online_collected_centavos + partialAmount,
      'Dashboard online collected should increase by collected amount'
    );
    assert.strictEqual(
      afterPartialStats.combined_centavos,
      initialStats.combined_centavos + partialAmount,
      'Dashboard combined sales should increase by collected amount'
    );
    console.log('✓ 3e. Dashboard sales today immediately reflected partial balance collection');

    // 3f. Test full collection of remaining balance
    const fullRes = await req(`/admin/orders/${testOrderCode}/record-balance`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ amount_centavos: 1000000 })
    });
    assert.strictEqual(fullRes.status, 200, `Full collection failed: ${JSON.stringify(fullRes.data)}`);
    assert.strictEqual(fullRes.data.balance_due_centavos, 0, 'Remaining balance should be 0');
    assert.strictEqual(fullRes.data.amount_paid_centavos, 3150000, 'Total amount paid should be 31,500.00');
    assert.strictEqual(fullRes.data.payment_status, 'Fully Paid', 'Payment status should be Fully Paid');
    console.log('✓ 3f. Full collection succeeded, balance is 0 and status is Fully Paid');

    // 3g. Check order list view has correct amount_paid and payment_status
    const orderViewRes = await req(`/admin/orders/${testOrderCode}`, { headers: authHeaders });
    assert.strictEqual(orderViewRes.status, 200);
    assert.strictEqual(orderViewRes.data.order.balance_due_centavos, 0);
    assert.strictEqual(orderViewRes.data.order.amount_paid_centavos, 3150000);
    assert.strictEqual(orderViewRes.data.order.payment_status, 'Fully Paid');
    console.log('✓ 3g. Order details view returns correct amount_paid and payment_status');

    // 3h. Attempt to collect when balance is 0
    const alreadyZeroRes = await req(`/admin/orders/${testOrderCode}/record-balance`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ amount_centavos: 100 })
    });
    assert.strictEqual(alreadyZeroRes.status, 409, 'Expected 409 when balance is already 0');
    assert.strictEqual(alreadyZeroRes.data.code, 'BALANCE_ALREADY_PAID');
    console.log('✓ 3h. Blocked collection when balance is 0');

    // 3i. Cancelled orders must be excluded from today's sales
    const preCancelStats = (await req('/admin/reports/dashboard', { headers: authHeaders })).data.stats.sales_today;
    await query('UPDATE orders SET status = $1 WHERE order_code = $2', ['CANCELLED', testOrderCode]);
    const postCancelStats = (await req('/admin/reports/dashboard', { headers: authHeaders })).data.stats.sales_today;
    assert.strictEqual(
      postCancelStats.online_collected_centavos,
      preCancelStats.online_collected_centavos - 1575000,
      'Cancelled order payments must be excluded from online collected'
    );
    console.log('✓ 3i. Cancelled order payments are excluded from today sales');

  } finally {
    // Cleanup test order (cascades to payments & history)
    await query('DELETE FROM orders WHERE order_code = $1', [testOrderCode]);
    console.log('Cleaned up test order');
  }

  console.log('--- ALL ITEM 4 AND ITEM 6 TESTS PASSED ---');
  process.exit(0);
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
