/**
 * Order service: creation, tracking, transitions, balance, cancellation.
 *
 * WHAT: Every order write runs as a database TRANSACTION that first locks the
 * order row (SELECT ... FOR UPDATE) and re-checks status before changing
 * anything. If a customer cancel and an admin move collide, exactly one wins
 * and the other gets a clear 409 - never a corrupted half-state.
 *
 * PRICING RULE: totals are computed SERVER-side from the live catalog. Prices
 * arriving from the browser are ignored entirely (the create schema does not
 * even accept a price field), so tampered payloads cannot discount an order.
 */

'use strict';

const crypto = require('crypto');
const config = require('../config/env');
const { query, getClient } = require('../config/db');
const { notFound, conflict, fail } = require('../utils/serviceError');
const { downpaymentFor, balanceFor } = require('../utils/money');
const {
  ORDER, REFUND, PAYMENT_STAGE, PAYMENT_CHANNEL,
  canTransition, cancellableByCustomer, cancelReturnsStock,
} = require('../utils/orderMachine');
const { consumeVerification } = require('./otpService');
const settingsService = require('./settingsService');

const MIN_BUNDLES = config.business.minOrderBundles;

/** WB- + 5 random digits. Collisions retry (unique constraint is the backstop). */
function generateOrderCode() {
  return `WB-${crypto.randomInt(10000, 100000)}`;
}

async function insertHistory(client, orderId, oldStatus, newStatus, changedBy, note) {
  await client.query(
    `INSERT INTO order_status_history
       (order_id, old_status, new_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5);`,
    [orderId, oldStatus, newStatus, changedBy, note || '']
  );
}

/**
 * Ownership gate shared by cancel + refund-details + track.
 * identity = { memberId, memberEmail } for signed-in members, or { email }
 * for guests. ALWAYS 404 on mismatch (never 403): confirming "this order
 * exists but is not yours" would leak other customers' order codes.
 */
async function findOwnedOrder(client, code, identity) {
  const { rows } = await client.query(
    'SELECT * FROM orders WHERE order_code = $1 FOR UPDATE;',
    [code.trim().toUpperCase()]
  );
  const order = rows[0];
  if (!order) {
    throw notFound(
      'No matching order found for this tracking ID.',
      'Walang nahanap na order para sa tracking ID na ito.'
    );
  }

  const orderEmail = (order.customer_email || '').toLowerCase();
  // Admin override: the dashboard acts on any order (JWT already verified).
  if (identity.adminBypass) return order;
  let owned = false;
  if (identity.memberId) {
    // Members own by id link OR by matching email (covers guest orders placed
    // before they registered, even before the Phase 4 backfill runs).
    owned = order.member_id === identity.memberId
      || orderEmail === (identity.memberEmail || '').toLowerCase();
  } else if (identity.email) {
    owned = orderEmail === identity.email.toLowerCase();
  }
  if (!owned) throw notFound(
    'No matching order found for this tracking ID.',
    'Walang nahanap na order para sa tracking ID na ito.'
  );
  return order;
}

/** Non-locking read variant for tracking pages (no write follows). */
async function findOrderForView(code, email) {
  const { rows } = await query('SELECT * FROM orders WHERE order_code = $1;', [
    code.trim().toUpperCase(),
  ]);
  const order = rows[0];
  if (!order || (order.customer_email || '').toLowerCase() !== email.toLowerCase()) {
    throw notFound(
      'No matching order found for this tracking ID.',
      'Walang nahanap na order para sa tracking ID na ito.'
    );
  }
  return order;
}

async function itemsFor(orderId) {
  const { rows } = await query(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC;',
    [orderId]
  );
  return rows;
}

async function refundFor(orderId) {
  const { rows } = await query('SELECT * FROM refund_requests WHERE order_id = $1;', [orderId]);
  return rows[0] || null;
}

async function historyFor(orderId) {
  const { rows } = await query(
    'SELECT old_status, new_status, changed_by, note, changed_at FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC;',
    [orderId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// CREATE: guest or member checkout (payment submission follows in Phase 4)
// ---------------------------------------------------------------------------
async function createOrder(input, idempotencyKey, opts = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Idempotency: a retried request (double-click, timeout) returns the
    // ORIGINAL order instead of creating a duplicate charge/order.
    if (idempotencyKey) {
      const { rows } = await client.query(
        'SELECT * FROM orders WHERE idempotency_key = $1;',
        [idempotencyKey]
      );
      if (rows.length > 0) {
        await client.query('ROLLBACK');
        return { duplicate: true, order: await orderView(rows[0].order_code) };
      }
    }

    // Guest checkout proves email ownership with a CHECKOUT OTP, consumed
    // atomically here (one code powers exactly one order). Signed-in members
    // checking out with their own verified email skip this (spec).
    if (opts.requireCheckoutOtp) {
      const claimed = await consumeVerification(client, input.customer.email, 'CHECKOUT');
      if (!claimed) {
        throw fail(409, 'OTP_REQUIRED',
          'Please verify your email with the OTP code to place this order.',
          'Pakiberipika muna ang email gamit ang OTP code upang mai-place ang order.');
      }
    }

    // Authoritative catalog lookup: price comes from the DB, never the browser.
    const productIds = [...new Set(input.items.map((i) => i.product_id))];
    const { rows: products } = await client.query(
      'SELECT * FROM products WHERE id = ANY($1::bigint[]);',
      [productIds]
    );
    const byId = new Map(products.map((p) => [p.id, p]));

    let subtotal = 0;
    let totalBundles = 0;
    const lines = [];
    for (const item of input.items) {
      const product = byId.get(item.product_id);
      if (!product || product.is_archived) {
        const productName = product ? product.name : `Product ${item.product_id}`;
        throw conflict(
          'PRODUCT_UNAVAILABLE',
          `"${productName}" is no longer available. Please update your cart.`,
          `Hindi na available ang "${productName}". Paki-update ang cart.`
        );
      }
      const lineTotal = product.price_bundle_centavos * item.bundles;
      subtotal += lineTotal;
      totalBundles += item.bundles;
      lines.push({
        product_id: product.id,
        product_name: product.name, // snapshot for truthful receipts
        pieces_per_bundle: product.pieces_per_bundle,
        bundles: item.bundles,
        unit_price_centavos: product.price_bundle_centavos,
        line_total_centavos: lineTotal,
      });
    }

    // Defense in depth: the validator already checked the 300 minimum, but the
    // service re-checks because validators can be bypassed by future callers.
    // The effective minimum is admin-editable in Settings (env as fallback).
    const minBundles = await settingsService.getNumber('min_order_bundles', MIN_BUNDLES);
    if (totalBundles < minBundles) {
      throw conflict(
        'BELOW_MINIMUM',
        `Online orders require a minimum of ${minBundles} bundles in total.`,
        `Ang online order ay kailangan ng hindi bababa sa ${minBundles} bundle sa kabuuan.`
      );
    }

    const total = subtotal; // No delivery fee in the system (confirmed).
    const downpayment = downpaymentFor(total);
    const balance = balanceFor(total, downpayment);

    // Link to a member immediately when the email already belongs to one.
    const email = input.customer.email;
    const { rows: memberRows } = await client.query(
      'SELECT id FROM members WHERE email = $1;',
      [email]
    );
    const memberId = memberRows[0] ? memberRows[0].id : null;

    // Insert with collision retry on the random order code (astronomically
    // rare, but a retry loop is cheaper than a 500 on a paying customer).
    let order = null;
    for (let attempt = 0; attempt < 5 && !order; attempt += 1) {
      try {
        const { rows } = await client.query(
          `INSERT INTO orders
             (order_code, member_id, customer_name, customer_email, customer_contact,
              delivery_address, delivery_date, delivery_time, notes,
              subtotal_centavos, total_centavos, downpayment_centavos,
              balance_due_centavos, payment_method, status, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING *;`,
          [
            generateOrderCode(), memberId,
            input.customer.name.trim(), email,
            input.customer.contact, input.customer.address.trim(),
            input.delivery_date || null, input.delivery_time,
            input.notes, subtotal, total, downpayment, balance,
            input.payment_method, ORDER.PAYMENT_UNDER_VERIFICATION,
            idempotencyKey || null,
          ]
        );
        order = rows[0];
      } catch (err) {
        if (err.code !== '23505' || attempt === 4) throw err;
      }
    }

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, product_name, pieces_per_bundle,
            bundles, unit_price_centavos, line_total_centavos)
         VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [order.id, line.product_id, line.product_name, line.pieces_per_bundle,
          line.bundles, line.unit_price_centavos, line.line_total_centavos]
      );
    }
    await insertHistory(client, order.id, null, ORDER.PAYMENT_UNDER_VERIFICATION,
      'SYSTEM', 'Order placed. Downpayment submitted, awaiting verification.');

    await client.query('COMMIT');
    return { duplicate: false, order: await orderView(order.order_code) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// READS: tracking (guest), member history, admin list
// ---------------------------------------------------------------------------
/** Payment attempts, latest first (metadata only - proofs stay private). */
async function paymentsFor(orderId) {
  const { rows } = await query(
    `SELECT id, stage, channel, reference_number, amount_centavos,
            verification_status, created_at
       FROM payments WHERE order_id = $1 ORDER BY created_at DESC;`,
    [orderId]
  );
  return rows;
}

async function orderView(code) {
  const { rows } = await query('SELECT * FROM orders WHERE order_code = $1;', [
    code.trim().toUpperCase(),
  ]);
  if (rows.length === 0) {
    throw notFound('Order not found.', 'Hindi nahanap ang order.');
  }
  const order = rows[0];
  const [items, refund, history, payments] = await Promise.all([
    itemsFor(order.id), refundFor(order.id), historyFor(order.id), paymentsFor(order.id),
  ]);
  return { ...order, items, refund, history, payments };
}

async function trackOrder(code, email) {
  const order = await findOrderForView(code, email);
  const [items, refund, history, payments] = await Promise.all([
    itemsFor(order.id), refundFor(order.id), historyFor(order.id), paymentsFor(order.id),
  ]);
  return { ...order, items, refund, history, payments };
}

async function memberOrders(memberId, memberEmail) {
  const { rows } = await query(
    `SELECT * FROM orders
      WHERE member_id = $1 OR customer_email = $2
      ORDER BY created_at DESC;`,
    [memberId, memberEmail.toLowerCase()]
  );
  // Attach items per order (N+1 is fine here: one customer's history is small).
  const orders = [];
  for (const order of rows) {
    orders.push({ ...order, items: await itemsFor(order.id), refund: await refundFor(order.id) });
  }
  return orders;
}

async function adminList(status) {
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE o.status = $1';
    params.push(status);
  }
  const { rows } = await query(
    `SELECT o.*, COALESCE(SUM(oi.bundles), 0)::int AS total_bundles
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${where}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 500;`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// TRANSITION: admin board moves (forward only, locked, history-logged)
// ---------------------------------------------------------------------------
async function transition(code, to, actor, note) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM orders WHERE order_code = $1 FOR UPDATE;',
      [code.trim().toUpperCase()]
    );
    if (rows.length === 0) {
      throw notFound('Order not found.', 'Hindi nahanap ang order.');
    }
    const order = rows[0];

    // PUV -> CONFIRMED belongs to payment approval (Phase 4: deducts stock).
    // ->CANCELLED belongs to cancel flows. The board moves the middle only.
    if (!canTransition(order.status, to)) {
      throw conflict(
        'ILLEGAL_TRANSITION',
        `Order cannot move from ${order.status} to ${to}.`,
        `Hindi maaaring ilipat ang order mula ${order.status} patungong ${to}.`
      );
    }
    // Completion means fully paid: the cash balance must be recorded first.
    if (to === ORDER.COMPLETED && order.balance_due_centavos > 0) {
      throw conflict(
        'BALANCE_UNPAID',
        'Record the cash balance payment before completing this order.',
        'I-record muna ang cash balance bago i-complete ang order.'
      );
    }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2;', [to, order.id]);
    await insertHistory(client, order.id, order.status, to, 'ADMIN', note || `Moved to ${to} by ${actor || 'admin'}.`);

    await client.query('COMMIT');
    return orderView(order.order_code);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// BALANCE: record the 50% cash payment collected face to face
// ---------------------------------------------------------------------------
async function recordBalance(code, actor, note) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM orders WHERE order_code = $1 FOR UPDATE;',
      [code.trim().toUpperCase()]
    );
    if (rows.length === 0) {
      throw notFound('Order not found.', 'Hindi nahanap ang order.');
    }
    const order = rows[0];

    const collectible = [ORDER.CONFIRMED, ORDER.IN_PRODUCTION, ORDER.OUT_FOR_DELIVERY];
    if (!collectible.includes(order.status)) {
      throw conflict(
        'BALANCE_NOT_DUE',
        `Balance cannot be collected while the order is ${order.status}.`,
        `Hindi maaaring kolektahin ang balance habang ${order.status} ang order.`
      );
    }
    if (order.balance_due_centavos <= 0) {
      throw conflict(
        'BALANCE_ALREADY_PAID',
        'The balance for this order is already fully paid.',
        'Bayad na ang buong balance ng order na ito.'
      );
    }

    const amount = order.balance_due_centavos;
    await client.query(
      `INSERT INTO payments
         (order_id, stage, channel, amount_centavos, reference_number,
          verification_status, verified_at)
       VALUES ($1, $2, $3, $4, 'CASH_COLLECTED', 'VERIFIED', NOW());`,
      [order.id, PAYMENT_STAGE.BALANCE, PAYMENT_CHANNEL.CASH, amount]
    );
    await client.query(
      'UPDATE orders SET balance_due_centavos = 0 WHERE id = $1;',
      [order.id]
    );

    await client.query('COMMIT');
    return { order_code: order.order_code, collected_centavos: amount, balance_due_centavos: 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// CANCEL: customer cancels + refund request in ONE transaction
// Steps: lock order -> ownership -> status window -> CANCELLED ->
// return stock (Confirmed only) -> insert refund -> history -> commit.
// ---------------------------------------------------------------------------
async function cancelOrder(code, identity, input, changedBy = 'CUSTOMER') {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const order = await findOwnedOrder(client, code, identity);

    if (!cancellableByCustomer(order.status)) {
      throw conflict(
        'ORDER_NOT_CANCELLABLE',
        'Production has started. This order can no longer be cancelled.',
        'Nagsimula na ang produksyon. Hindi na maaaring kanselahin ang order.'
      );
    }

    // Confirmed orders had stock deducted at approval: return every bundle.
    if (cancelReturnsStock(order.status)) {
      const { rows: items } = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1 ORDER BY product_id ASC;',
        [order.id]
      );
      // Lock products in id order (consistent ordering prevents deadlocks when
      // two transactions touch overlapping product sets).
      for (const item of items) {
        if (!item.product_id) continue; // legacy snapshot without link
        await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE;', [item.product_id]);
        const pieces = item.bundles * item.pieces_per_bundle;
        await client.query(
          'UPDATE products SET stock_pieces = stock_pieces + $1 WHERE id = $2;',
          [pieces, item.product_id]
        );
        await client.query(
          `INSERT INTO stock_movements
             (product_id, change_pieces, reason, order_id, note, created_by)
           VALUES ($1, $2, 'CANCELLATION_RETURN', $3, $4, $5);`,
          [item.product_id, pieces, order.id,
            `Cancel ${order.order_code}: returned ${item.bundles} bundles`, changedBy]
        );
      }
    }

    await client.query('UPDATE orders SET status = $1 WHERE id = $2;',
      [ORDER.CANCELLED, order.id]);

    // Full downpayment, no fee. UNIQUE(order_id) makes double-cancel impossible
    // at the database level even if two requests slip past the status check.
    // Admin path: wallet unknown -> AWAITING_DETAILS with NULL wallet fields;
    // customer submits them later. reason_source stays in the CHECK set.
    const isAdmin = changedBy !== 'CUSTOMER';
    const { rows: refunds } = await client.query(
      `INSERT INTO refund_requests
         (order_id, reason, reason_source, wallet_type, account_number,
          account_name, refund_amount_centavos, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *;`,
      [order.id, input.reason.trim(), isAdmin ? 'ADMIN_REJECTION' : 'CUSTOMER',
        isAdmin ? null : input.wallet_type,
        isAdmin ? null : input.account_number,
        isAdmin ? '' : input.account_name.trim(),
        order.downpayment_centavos,
        isAdmin ? REFUND.AWAITING_DETAILS : REFUND.PENDING]
    );

    await insertHistory(client, order.id, order.status, ORDER.CANCELLED,
      changedBy, `Cancelled by ${isAdmin ? 'admin' : 'customer'}. Reason: ${input.reason.trim()}`);

    await client.query('COMMIT');
    return {
      order_code: order.order_code,
      status: ORDER.CANCELLED,
      refund: refunds[0],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    // 23505 here = a refund row already exists (double submit raced).
    if (err.code === '23505') {
      throw conflict(
        'REFUND_EXISTS',
        'A refund request already exists for this order.',
        'May refund request na para sa order na ito.'
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createOrder,
  orderView,
  trackOrder,
  memberOrders,
  adminList,
  transition,
  recordBalance,
  cancelOrder,
  findOwnedOrder,
};
