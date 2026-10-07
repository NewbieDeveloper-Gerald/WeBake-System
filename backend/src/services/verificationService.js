/**
 * Verification queue: PUV orders awaiting downpayment review.
 *
 * WHAT: Lists every order under verification WITH its pending payment,
 * line items, resubmit state, and a short-lived signed URL for the private
 * proof photo. One payload renders the whole admin verification screen.
 *
 * STORAGE-DISABLED MODE: the queue still returns (order data is useful), but
 * proof_url is null and storage_enabled is false so the UI can say so. Only
 * one PENDING downpayment can exist per order (submission blocks duplicates),
 * so the join below yields exactly one row per queued order.
 */

'use strict';

const { query } = require('../config/db');
const { ORDER } = require('../utils/orderMachine');
const storage = require('./storageService');

async function queue() {
  const { rows } = await query(
    `SELECT o.*,
            p.id AS payment_id, p.channel AS payment_channel,
            p.reference_number, p.proof_storage_path,
            p.amount_centavos AS paid_centavos, p.created_at AS submitted_at
       FROM orders o
       JOIN payments p ON p.order_id = o.id
      WHERE o.status = $1
        AND p.stage = 'DOWNPAYMENT' AND p.verification_status = 'PENDING'
      ORDER BY p.created_at ASC;`,
    [ORDER.PAYMENT_UNDER_VERIFICATION]
  );

  if (rows.length === 0) {
    return { count: 0, storage_enabled: storage.isEnabled(), queue: [] };
  }

  const orderIds = rows.map((r) => r.id);
  const { rows: itemRows } = await query(
    'SELECT * FROM order_items WHERE order_id = ANY($1::bigint[]) ORDER BY id ASC;',
    [orderIds]
  );
  const itemsByOrder = new Map();
  for (const it of itemRows) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push(it);
  }

  const queueRows = [];
  for (const r of rows) {
    let proofUrl = null;
    if (storage.isEnabled() && r.proof_storage_path) {
      try {
        proofUrl = await storage.signedViewUrl(r.proof_storage_path);
      } catch {
        proofUrl = null; // Missing file: UI shows "proof unavailable".
      }
    }
    queueRows.push({
      order: {
        order_code: r.order_code,
        customer_name: r.customer_name,
        customer_email: r.customer_email,
        customer_contact: r.customer_contact,
        delivery_address: r.delivery_address,
        total_centavos: r.total_centavos,
        downpayment_centavos: r.downpayment_centavos,
        balance_due_centavos: r.balance_due_centavos,
        payment_method: r.payment_method,
        status: r.status,
        resubmit_count: r.resubmit_count,
        rejection_reason: r.rejection_reason,
        created_at: r.created_at,
      },
      payment: {
        id: r.payment_id,
        channel: r.payment_channel,
        reference_number: r.reference_number,
        amount_centavos: r.paid_centavos,
        submitted_at: r.submitted_at,
      },
      items: itemsByOrder.get(r.id) || [],
      proof_url: proofUrl,
    });
  }
  return { count: queueRows.length, storage_enabled: storage.isEnabled(), queue: queueRows };
}

module.exports = { queue };
