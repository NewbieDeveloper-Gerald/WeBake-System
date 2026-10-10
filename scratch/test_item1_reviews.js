'use strict';

const assert = require('assert');
const { query } = require('../backend/src/config/db');
const { signMemberToken } = require('../backend/src/utils/jwt');

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
  console.log('--- Testing Item 1: Reviews Restricted to Completed Orders ---');

  // 1. Unauthenticated review submission is rejected
  const unauthRes = await req('/reviews', {
    method: 'POST',
    body: JSON.stringify({
      order_code: 'DUMMY-ORD',
      product_id: 1,
      rating: 5,
      comment: 'Unauthenticated test'
    })
  });
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated user must be rejected with 401');
  console.log('✓ 1. Unauthenticated review submission correctly rejected with 401');

  // 2. Setup test member and orders
  const testEmail = `reviewer_${Date.now()}@example.com`;
  const memberInsert = await query(
    `INSERT INTO members (full_name, email, password_hash, contact, address)
     VALUES ($1, $2, 'dummyhash', '09123456789', '123 Test St')
     RETURNING id, full_name, email;`,
    ['Test Reviewer', testEmail]
  );
  const testMember = { id: memberInsert.rows[0].id, name: memberInsert.rows[0].full_name, email: memberInsert.rows[0].email };
  const memberToken = signMemberToken(testMember);
  const memberHeaders = { Authorization: `Bearer ${memberToken}` };

  const activeOrderCode = 'TEST-REV-ACT-' + Date.now().toString().slice(-4);
  const completedOrderCode = 'TEST-REV-CMP-' + Date.now().toString().slice(-4);

  // Get a real product ID
  const prodRes = await query('SELECT id FROM products WHERE is_archived = false LIMIT 1;');
  const testProductId = prodRes.rows[0].id;

  try {
    // 2a. Insert active (CONFIRMED) order for member
    const activeOrder = await query(
      `INSERT INTO orders (
        order_code, member_id, customer_name, customer_email, customer_contact,
        delivery_address, subtotal_centavos, total_centavos, downpayment_centavos,
        downpayment_paid_centavos, balance_due_centavos, payment_method, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id;`,
      [
        activeOrderCode, testMember.id, testMember.name, testEmail, '09123456789',
        '123 Test St', 10500, 10500, 5250, 5250, 5250, 'GCASH', 'CONFIRMED'
      ]
    );
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name, pieces_per_bundle, bundles, unit_price_centavos, line_total_centavos)
       VALUES ($1, $2, 'Test Product', 25, 1, 10500, 10500);`,
      [activeOrder.rows[0].id, testProductId]
    );

    // 2b. Insert completed (COMPLETED) order for member
    const completedOrder = await query(
      `INSERT INTO orders (
        order_code, member_id, customer_name, customer_email, customer_contact,
        delivery_address, subtotal_centavos, total_centavos, downpayment_centavos,
        downpayment_paid_centavos, balance_due_centavos, payment_method, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id;`,
      [
        completedOrderCode, testMember.id, testMember.name, testEmail, '09123456789',
        '123 Test St', 10500, 10500, 5250, 5250, 0, 'GCASH', 'COMPLETED'
      ]
    );
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name, pieces_per_bundle, bundles, unit_price_centavos, line_total_centavos)
       VALUES ($1, $2, 'Test Product', 25, 1, 10500, 10500);`,
      [completedOrder.rows[0].id, testProductId]
    );

    // 3. Attempt review for CONFIRMED order -> should be rejected with 403 ORDER_NOT_COMPLETED
    const nonCompletedRes = await req('/reviews', {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        order_code: activeOrderCode,
        product_id: testProductId,
        rating: 5,
        text: 'Great bread'
      })
    });
    assert.strictEqual(nonCompletedRes.status, 403, 'Review on uncompleted order must be 403');
    assert.strictEqual(nonCompletedRes.data.code, 'ORDER_NOT_COMPLETED');
    console.log('✓ 3. Non-completed order review correctly rejected with 403 ORDER_NOT_COMPLETED');

    // 4. Check eligibility endpoint
    const eligRes = await req(`/reviews/eligibility?product_id=${testProductId}`, {
      headers: memberHeaders
    });
    assert.strictEqual(eligRes.status, 200);
    assert.strictEqual(eligRes.data.eligible, true, 'Member with completed order should be eligible');
    console.log('✓ 4. Eligibility endpoint correctly identifies eligible completed order');

    // 5. Submit valid review for COMPLETED order -> should succeed
    const submitRes = await req('/reviews', {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        order_code: completedOrderCode,
        product_id: testProductId,
        rating: 5,
        text: 'Delicious and fresh!'
      })
    });
    assert.strictEqual(submitRes.status, 201, `Review submit failed: ${JSON.stringify(submitRes.data)}`);
    console.log('✓ 5. Review successfully submitted for completed order');

    // 6. Duplicate review for the same product and order -> rejected with 409
    const dupRes = await req('/reviews', {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        order_code: completedOrderCode,
        product_id: testProductId,
        rating: 4,
        text: 'Trying duplicate'
      })
    });
    assert.strictEqual(dupRes.status, 409, 'Duplicate review must return 409');
    assert.strictEqual(dupRes.data.code, 'DUPLICATE_REVIEW');
    console.log('✓ 6. Duplicate review correctly rejected with 409 DUPLICATE_REVIEW');

    // 7. Re-check eligibility endpoint -> now should report eligible: false (already reviewed)
    const afterEligRes = await req(`/reviews/eligibility?product_id=${testProductId}`, {
      headers: memberHeaders
    });
    assert.strictEqual(afterEligRes.status, 200);
    assert.strictEqual(afterEligRes.data.eligible, false, 'Member should not be eligible after reviewing');
    console.log('✓ 7. Eligibility endpoint reflects that review has already been submitted');

  } finally {
    // Cleanup test data
    await query('DELETE FROM reviews WHERE member_id = $1', [testMember.id]);
    await query('DELETE FROM orders WHERE order_code IN ($1, $2)', [activeOrderCode, completedOrderCode]);
    await query('DELETE FROM members WHERE id = $1', [testMember.id]);
    console.log('Cleaned up test data');
  }

  console.log('--- ALL ITEM 1 TESTS PASSED ---');
  process.exit(0);
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
