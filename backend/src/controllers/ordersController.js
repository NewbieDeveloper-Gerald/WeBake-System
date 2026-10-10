/**
 * Orders controller.
 *
 * IDENTITY PATTERN (cancel + refund-details + payment): the same endpoint
 * serves members and guests. When a Bearer token is present AND valid for a
 * member, identity comes from the token; otherwise the request must carry the
 * order's email. Either way, orderService enforces ownership - the controller
 * only packages "who is asking" into one identity object.
 *
 * CHECKOUT OTP (Phase 4): guests prove email ownership with a CHECKOUT code
 * consumed inside the creation transaction. Signed-in members checking out
 * with their own verified email skip it (spec: no OTP at later checkouts).
 */

'use strict';

const orderService = require('../services/orderService');
const refundService = require('../services/refundService');
const mailer = require('../services/mailerService');
const { verifyToken, bearerFromHeader } = require('../utils/jwt');

/** Header wins (standard practice); body key is the fallback for old clients. */
function idempotencyKey(req) {
  return (req.headers['x-idempotency-key'] || req.body.idempotency_key || '').trim() || null;
}

function identityFrom(req) {
  const payload = verifyToken(bearerFromHeader(req));
  if (payload && payload.role === 'member') {
    return { memberId: payload.sub, memberEmail: payload.email };
  }
  // Guest path: email must have been validated into req.body by the schema.
  return { email: (req.body.email || '').toLowerCase() };
}

function memberFromHeader(req) {
  const payload = verifyToken(bearerFromHeader(req));
  return payload && payload.role === 'member' ? payload : null;
}

async function create(req, res) {
  // All checkouts require verified OTP email verification per the customer ordering flow.
  const result = await orderService.createOrder(req.body, idempotencyKey(req), {
    requireCheckoutOtp: true,
  });
  // 200 on idempotent replay (nothing new created), 201 on a fresh order.
  return res.status(result.duplicate ? 200 : 201).json({
    success: true,
    duplicate: result.duplicate,
    order: result.order,
  });
}

async function track(req, res) {
  const order = await orderService.trackOrder(req.query.code, req.query.email);
  return res.json({ success: true, order });
}

async function mine(req, res) {
  const orders = await orderService.memberOrders(req.member.id, req.member.email);
  return res.json({ success: true, count: orders.length, orders });
}

async function cancel(req, res) {
  const result = await orderService.cancelOrder(
    req.params.code, identityFrom(req), req.body, 'CUSTOMER'
  );
  // Post-commit email: best-effort, never rolls back the cancellation.
  const view = await orderService.orderView(req.params.code);
  mailer.bestEffort(
    mailer.sendRefundReceived(view.customer_email, { order: view, refund: result.refund }),
    `refund-received ${view.order_code}`
  );
  return res.json({
    success: true,
    message: 'Order cancelled. Your refund request is now pending.',
    message_en: 'Order cancelled. Your refund request is now pending.',
    ...result,
  });
}

async function refundDetails(req, res) {
  const result = await refundService.submitDetails(
    req.params.code, identityFrom(req), req.body
  );
  return res.json({
    success: true,
    message: 'Wallet details saved. Your refund is now pending.',
    message_en: 'Wallet details saved. Your refund is now pending.',
    ...result,
  });
}

async function adminList(req, res) {
  const orders = await orderService.adminList(req.query.status);
  return res.json({ success: true, count: orders.length, orders });
}

async function transition(req, res) {
  const order = await orderService.transition(
    req.params.code, req.body.status, req.admin.email, req.body.note
  );
  return res.json({ success: true, order });
}

async function recordBalance(req, res) {
  const receipt = await orderService.recordBalance(
    req.params.code, req.admin.email, req.body.note
  );
  return res.json({ success: true, ...receipt });
}

async function adminCancel(req, res) {
  const result = await orderService.cancelOrder(
    req.params.code, { adminBypass: true }, { reason: req.body.reason },
    'ADMIN'
  );
  const view = await orderService.orderView(req.params.code);
  if (result.refund && result.refund.status !== 'CLOSED_NO_PAYMENT') {
    mailer.bestEffort(
      mailer.sendRefundReceived(view.customer_email, { order: view, refund: result.refund }),
      `refund-received ${view.order_code}`
    );
  }
  return res.json({ success: true, ...result });
}

async function detail(req, res) {
  const order = await orderService.orderView(req.params.code);
  return res.json({ success: true, order });
}

module.exports = {
  create, track, mine, cancel, refundDetails,
  adminList, transition, recordBalance, adminCancel, detail,
  identityFrom, // shared with paymentsController (one identity rule)
};
