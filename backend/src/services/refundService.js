/**
 * Refund service: customer wallet-details submit + owner queue actions.
 *
 * WHAT: submitDetails (AWAITING_DETAILS -> PENDING), adminQueue (counts +
 * rows for the badge and board), markRefunded (-> REFUNDED), and
 * closeWithoutRefund (-> CLOSED_NO_PAYMENT with mandatory note).
 *
 * LIFECYCLE: PENDING means "details on file, money not sent yet". The owner
 * sends money MANUALLY outside the system; the API only records the result.
 * Emails for each step are wired in Phase 4 when the mailer exists - these
 * functions already return everything the templates need.
 */

'use strict';

const { query, getClient } = require('../config/db');
const { notFound, conflict } = require('../utils/serviceError');
const { REFUND } = require('../utils/orderMachine');
const { findOwnedOrder } = require('./orderService');

/** Customer provides wallet details after an admin rejection (Phase 4 flow). */
async function submitDetails(code, identity, input) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const order = await findOwnedOrder(client, code, identity);

    const { rows } = await client.query(
      'SELECT * FROM refund_requests WHERE order_id = $1 FOR UPDATE;',
      [order.id]
    );
    const refund = rows[0];
    if (!refund || refund.status !== REFUND.AWAITING_DETAILS) {
      throw conflict(
        'NO_AWAITING_REFUND',
        'This order is not waiting for wallet details.',
        'Ang order na ito ay hindi naghihintay ng wallet details.'
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE refund_requests
          SET wallet_type = $1, account_number = $2, account_name = $3,
              status = $4
        WHERE id = $5
        RETURNING *;`,
      [input.wallet_type, input.account_number, input.account_name.trim(),
        REFUND.PENDING, refund.id]
    );

    await client.query('COMMIT');
    return { order_code: order.order_code, refund: updated[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Dashboard badge count + queue rows with order/customer context. */
async function adminQueue() {
  const { rows: counts } = await query(
    `SELECT status, COUNT(*)::int AS n FROM refund_requests GROUP BY status;`
  );
  const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.n]));
  const alertCount = (byStatus[REFUND.AWAITING_DETAILS] || 0) + (byStatus[REFUND.PENDING] || 0);

  const { rows: refunds } = await query(
    `SELECT r.*, o.order_code, o.customer_name, o.customer_email,
            o.customer_contact, o.total_centavos, o.downpayment_centavos,
            o.status AS order_status
       FROM refund_requests r
       JOIN orders o ON o.id = r.order_id
       ORDER BY r.requested_at DESC
       LIMIT 500;`
  );
  return { alertCount, byStatus, refunds };
}

/** Owner sent the money manually and records the wallet reference (optional). */
async function markRefunded(id, { admin_reference_number, note }, actor) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE;',
      [id]
    );
    const refund = rows[0];
    if (!refund) {
      throw notFound('Refund request not found.', 'Hindi nahanap ang refund request.');
    }
    // Money cannot be "sent" without wallet details - owner must wait for them.
    if (refund.status !== REFUND.PENDING) {
      throw conflict(
        'REFUND_NOT_PENDING',
        `Only pending refunds can be marked refunded (current: ${refund.status}).`,
        `Pending refunds lang ang maaaring i-mark na refunded (ngayon: ${refund.status}).`
      );
    }

    const mergedNote = [refund.admin_note, note ? `[${actor || 'admin'}] ${note}` : '']
      .filter(Boolean).join(' ').trim();
    const { rows: updated } = await client.query(
      `UPDATE refund_requests
          SET status = $1, processed_at = NOW(),
              admin_reference_number = $2, admin_note = $3
        WHERE id = $4
        RETURNING *;`,
      [REFUND.REFUNDED, admin_reference_number || '', mergedNote, id]
    );

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Owner confirms NO money arrived (fake proof) and closes without sending.
 * Allowed only from AWAITING_DETAILS or PENDING; note is mandatory because
 * the customer reads it in the "refund closed" email (spec Q11).
 */
async function closeWithoutRefund(id, { admin_note }, actor) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE;',
      [id]
    );
    const refund = rows[0];
    if (!refund) {
      throw notFound('Refund request not found.', 'Hindi nahanap ang refund request.');
    }
    const closable = [REFUND.AWAITING_DETAILS, REFUND.PENDING];
    if (!closable.includes(refund.status)) {
      throw conflict(
        'REFUND_NOT_CLOSABLE',
        `Only awaiting or pending refunds can be closed (current: ${refund.status}).`,
        `Awaiting o pending refunds lang ang maaaring isara (ngayon: ${refund.status}).`
      );
    }

    const mergedNote = [`[${actor || 'admin'}] ${admin_note.trim()}`,
      refund.admin_note].filter(Boolean).join(' ').trim();
    const { rows: updated } = await client.query(
      `UPDATE refund_requests
          SET status = $1, processed_at = NOW(), admin_note = $2
        WHERE id = $3
        RETURNING *;`,
      [REFUND.CLOSED_NO_PAYMENT, mergedNote, id]
    );

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Single refund + its order (for emails and detail views). */
async function getWithOrder(id) {
  const { rows } = await query(
    `SELECT r.*, o.order_code, o.customer_name, o.customer_email,
            o.customer_contact, o.total_centavos, o.downpayment_centavos,
            o.status AS order_status
       FROM refund_requests r
       JOIN orders o ON o.id = r.order_id
       WHERE r.id = $1;`,
    [id]
  );
  if (rows.length === 0) {
    throw notFound('Refund request not found.', 'Hindi nahanap ang refund request.');
  }
  const row = rows[0];
  return {
    refund: row,
    order: {
      order_code: row.order_code,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      customer_contact: row.customer_contact,
      total_centavos: Number(row.total_centavos),
      downpayment_centavos: Number(row.downpayment_centavos),
      status: row.order_status,
    },
  };
}

module.exports = { submitDetails, adminQueue, markRefunded, closeWithoutRefund, getWithOrder };
