/**
 * Admin refunds controller: queue + mark-refunded + close-without-refund.
 * (Customer cancel-details submit lives in ordersController, next to cancel.)
 *
 * Each action emails the customer AFTER commit (best-effort): the money
 * decision is already recorded, and a mail outage must never undo it.
 */

'use strict';

const refundService = require('../services/refundService');
const mailer = require('../services/mailerService');

async function queue(req, res) {
  const result = await refundService.adminQueue();
  return res.json({ success: true, ...result });
}

async function markRefunded(req, res) {
  const refund = await refundService.markRefunded(
    req.params.id,
    { admin_reference_number: req.body.admin_reference_number, note: req.body.note },
    req.admin.email
  );
  const ctx = await refundService.getWithOrder(req.params.id);
  mailer.bestEffort(
    mailer.sendRefundCompleted(ctx.order.customer_email, { order: ctx.order, refund }),
    `refund-completed ${ctx.order.order_code}`
  );
  return res.json({ success: true, refund });
}

async function close(req, res) {
  const refund = await refundService.closeWithoutRefund(
    req.params.id,
    { admin_note: req.body.admin_note },
    req.admin.email
  );
  const ctx = await refundService.getWithOrder(req.params.id);
  mailer.bestEffort(
    mailer.sendRefundClosed(ctx.order.customer_email, { order: ctx.order, refund }),
    `refund-closed ${ctx.order.order_code}`
  );
  return res.json({ success: true, refund });
}

module.exports = { queue, markRefunded, close };
