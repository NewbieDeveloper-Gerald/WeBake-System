/**
 * Payment service: downpayment submission, approval, rejection.
 *
 * WHAT: submitDownpayment (customer uploads proof), approveDownpayment
 * (deducts stock, CONFIRMED), rejectDownpayment (resubmit-once, else cancel +
 * Awaiting Details refund).
 *
 * TRANSACTION SHAPE: identical to cancel - lock order -> re-check status ->
 * change -> history -> commit. Approval additionally locks every product row
 * so the stock check and deduction are atomic (two approvals cannot oversell
 * the same last bundle).
 *
 * Q4 (allow now, check at approval): creation never blocks on stock; approval
 * fails with 409 INSUFFICIENT_STOCK + per-product details when short. The
 * Phase 5 UI turns that payload into the owner-to-customer notice.
 */

'use strict';

const { getClient } = require('../config/db');
const { fail, conflict } = require('../utils/serviceError');
const { ORDER, REFUND, PAYMENT_STAGE } = require('../utils/orderMachine');
const { findOwnedOrder, orderView } = require('./orderService');
const storage = require('./storageService');
const mailer = require('./mailerService');

async function latestDownpayment(client, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM payments
      WHERE order_id = $1 AND stage = 'DOWNPAYMENT'
      ORDER BY created_at DESC LIMIT 1;`,
    [orderId]
  );
  return rows[0] || null;
}

async function insertHistory(client, orderId, oldStatus, newStatus, changedBy, note) {
  await client.query(
    `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5);`,
    [orderId, oldStatus, newStatus, changedBy, note || '']
  );
}

// ---------------------------------------------------------------------------
// SUBMIT: first payment or the single allowed resubmission (Q10)
// ---------------------------------------------------------------------------
async function submitDownpayment(code, identity, { channel, reference_number }, file) {
  if (!file || !file.buffer) {
    throw fail(400, 'PROOF_REQUIRED',
      'A proof-of-payment photo is required.');
  }

  // Upload BEFORE opening the transaction: network I/O must never hold a DB
  // transaction open. Trade-off: if the insert below fails, an orphan file
  // stays in the private bucket (harmless, tiny, invisible to customers).
  const { path: proofPath } = await storage.uploadProof(file.buffer, {
    orderCode: code.trim().toUpperCase(),
    mimetype: file.mimetype,
  });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const order = await findOwnedOrder(client, code, identity);
    if (order.status !== ORDER.PAYMENT_UNDER_VERIFICATION) {
      throw conflict('PAYMENT_NOT_ACCEPTED',
        `Downpayment cannot be submitted while the order is ${order.status}.`);
    }

    const prev = await latestDownpayment(client, order.id);
    let resubmitted = false;
    if (prev) {
      if (prev.verification_status === 'PENDING') {
        throw conflict('PAYMENT_PENDING',
          'A downpayment is already awaiting verification for this order.');
      }
      if (prev.verification_status === 'REJECTED') {
        // One resubmission only: resubmit_count was set to 1 at rejection.
        // (A second rejection cancels the order, so this path is reachable
        // exactly once per order by construction.)
        resubmitted = true;
      }
    }

    const { rows } = await client.query(
      `INSERT INTO payments
         (order_id, stage, channel, amount_centavos, reference_number,
          proof_storage_path, verification_status)
       VALUES ($1, 'DOWNPAYMENT', $2, $3, $4, $5, 'PENDING')
       RETURNING *;`,
      [order.id, channel, order.downpayment_centavos, reference_number.trim(), proofPath]
    );

    await client.query('COMMIT');

    // Receipt email is best-effort: the payment row already committed and a
    // mail outage must never undo a customer's submission.
    const view = await orderView(order.order_code);
    mailer.bestEffort(
      mailer.sendReceipt(order.customer_email, { order: view, items: view.items }),
      `receipt ${order.order_code}`
    );
    return { order_code: order.order_code, payment: rows[0], resubmitted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// APPROVE: verify proof -> deduct stock -> CONFIRMED
// ---------------------------------------------------------------------------
async function approveDownpayment(code, actor) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      'SELECT * FROM orders WHERE order_code = $1 FOR UPDATE;',
      [code.trim().toUpperCase()]
    );
    const order = orderRows[0];
    if (!order) {
      throw fail(404, 'NOT_FOUND', 'Order not found.');
    }
    if (order.status !== ORDER.PAYMENT_UNDER_VERIFICATION) {
      throw conflict('APPROVE_WRONG_STATE',
        `Only orders under verification can be approved (current: ${order.status}).`);
    }
    const payment = await latestDownpayment(client, order.id);
    if (!payment || payment.verification_status !== 'PENDING') {
      throw conflict('PAYMENT_NOT_PENDING',
        'There is no pending downpayment to approve for this order.');
    }

    // Lock products in id order, then check AND deduct atomically.
    const { rows: items } = await client.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY product_id ASC;',
      [order.id]
    );
    const quantitiesByProduct = new Map();
    for (const item of items) {
      if (!item.product_id) continue;
      const saved = quantitiesByProduct.get(item.product_id) || {
        bundles: 0, pieces_per_bundle: item.pieces_per_bundle, product_name: item.product_name,
      };
      saved.bundles += item.bundles;
      quantitiesByProduct.set(item.product_id, saved);
    }
    const shortages = [];
    const deductions = [];
    for (const [productId, quantity] of [...quantitiesByProduct.entries()].sort((a, b) => a[0] - b[0])) {
      const { rows: pRows } = await client.query(
        'SELECT * FROM products WHERE id = $1 FOR UPDATE;', [productId]
      );
      const product = pRows[0];
      if (!product || product.is_archived) {
        shortages.push({ product: quantity.product_name, reason: 'archived or missing' });
        continue;
      }
      const need = quantity.bundles * quantity.pieces_per_bundle;
      if (product.stock_pieces < need) {
        shortages.push({
          product: product.name,
          needed_pieces: need,
          available_pieces: product.stock_pieces,
        });
      } else {
        deductions.push({ product, need, bundles: quantity.bundles });
      }
    }
    if (shortages.length > 0) {
      // Q4: block approval, hand the UI structured data for the notice email.
      throw Object.assign(
        conflict('INSUFFICIENT_STOCK',
          'Insufficient stock to confirm this order. Notify the customer.'),
        { details: { shortages } }
      );
    }

    for (const { product, need, bundles } of deductions) {
      await client.query(
        'UPDATE products SET stock_pieces = stock_pieces - $1 WHERE id = $2;',
        [need, product.id]
      );
      await client.query(
        `INSERT INTO stock_movements
           (product_id, change_pieces, reason, order_id, note, created_by)
         VALUES ($1, $2, 'APPROVAL_DEDUCTION', $3, $4, $5);`,
        [product.id, -need, order.id,
          `Approve ${order.order_code}: ${bundles} bundles`, actor || '']
      );
    }

    await client.query(
      `UPDATE payments SET verification_status = 'VERIFIED', verified_at = NOW()
        WHERE id = $1;`,
      [payment.id]
    );
    await client.query(
      `UPDATE orders SET status = $1, downpayment_paid_centavos = downpayment_centavos
        WHERE id = $2;`,
      [ORDER.CONFIRMED, order.id]
    );
    await insertHistory(client, order.id, order.status, ORDER.CONFIRMED, 'ADMIN',
      `Downpayment verified by ${actor || 'admin'} (${payment.channel} ${payment.reference_number}).`);

    await client.query('COMMIT');

    const view = await orderView(order.order_code);
    mailer.bestEffort(mailer.sendApproved(order.customer_email, { order: view }),
      `approved ${order.order_code}`);
    return { order: view };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// REJECT: first rejection grants ONE resubmit; second cancels + Awaiting refund
// ---------------------------------------------------------------------------
async function rejectDownpayment(code, actor, reason) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      'SELECT * FROM orders WHERE order_code = $1 FOR UPDATE;',
      [code.trim().toUpperCase()]
    );
    const order = orderRows[0];
    if (!order) {
      throw fail(404, 'NOT_FOUND', 'Order not found.');
    }
    if (order.status !== ORDER.PAYMENT_UNDER_VERIFICATION) {
      throw conflict('REJECT_WRONG_STATE',
        `Only orders under verification can be rejected (current: ${order.status}).`);
    }
    const payment = await latestDownpayment(client, order.id);
    if (!payment || payment.verification_status !== 'PENDING') {
      throw conflict('PAYMENT_NOT_PENDING',
        'There is no pending downpayment to reject for this order.');
    }

    await client.query(
      `UPDATE payments SET verification_status = 'REJECTED' WHERE id = $1;`,
      [payment.id]
    );

    // No stock was ever deducted in PUV, so neither branch touches inventory.
    const firstRejection = order.resubmit_count < 1;
    if (firstRejection) {
      await client.query(
        'UPDATE orders SET resubmit_count = 1, rejection_reason = $1 WHERE id = $2;',
        [reason.trim(), order.id]
      );
      // No history row: history logs STATUS changes; the payment row records
      // this rejection. (Second rejection changes status -> history below.)
    } else {
      await client.query('UPDATE orders SET status = $1 WHERE id = $2;',
        [ORDER.CANCELLED, order.id]);
      await client.query(
        `INSERT INTO refund_requests
           (order_id, reason, reason_source, refund_amount_centavos, status)
         VALUES ($1, $2, 'ADMIN_REJECTION', $3, $4);`,
        [order.id, reason.trim(), order.downpayment_centavos, REFUND.AWAITING_DETAILS]
      );
      await insertHistory(client, order.id, order.status, ORDER.CANCELLED, 'ADMIN',
        `Downpayment rejected twice (${reason.trim()}). Refund awaiting wallet details.`);
    }

    await client.query('COMMIT');

    const view = await orderView(order.order_code);
    mailer.bestEffort(
      mailer.sendRejected(order.customer_email,
        { order: view, reason: reason.trim(), resubmitAllowed: firstRejection }),
      `rejected ${order.order_code}`
    );
    return {
      order_code: order.order_code,
      status: firstRejection ? ORDER.PAYMENT_UNDER_VERIFICATION : ORDER.CANCELLED,
      resubmit_allowed: firstRejection,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { submitDownpayment, approveDownpayment, rejectDownpayment };
