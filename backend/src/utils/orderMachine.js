/**
 * Order/refund state machines: the single source of truth for status rules.
 *
 * WHAT: Canonical status constants, the allowed-transition map, and guard
 * functions (canTransition, cancellableByCustomer).
 *
 * WHY one file: status rules were scattered across route handlers in the old
 * code, which is how impossible states ("refunded but still baking") happen.
 * Every service asks THIS module before changing a status, and the database
 * CHECK constraints mirror the same lists as a second line of defense.
 *
 * ONLINE ORDER LIFECYCLE:
 *   PAYMENT_UNDER_VERIFICATION -> CONFIRMED -> IN_PRODUCTION
 *     -> OUT_FOR_DELIVERY -> COMPLETED
 *   Cancel is allowed only from the first two states; it jumps straight to
 *   CANCELLED (no extra order statuses - the refund is tracked separately).
 */

'use strict';

const ORDER = Object.freeze({
  PAYMENT_UNDER_VERIFICATION: 'PAYMENT_UNDER_VERIFICATION',
  CONFIRMED: 'CONFIRMED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

const REFUND = Object.freeze({
  AWAITING_DETAILS: 'AWAITING_DETAILS',
  PENDING: 'PENDING',
  REFUNDED: 'REFUNDED',
  CLOSED_NO_PAYMENT: 'CLOSED_NO_PAYMENT',
});

const PAYMENT_STAGE = Object.freeze({ DOWNPAYMENT: 'DOWNPAYMENT', BALANCE: 'BALANCE' });
const PAYMENT_CHANNEL = Object.freeze({ GCASH: 'GCASH', MAYA: 'MAYA', CASH: 'CASH' });
const WALLET = Object.freeze({ GCASH: 'GCASH', PAYMAYA: 'PAYMAYA' });

/** Every legal move. Anything missing here is rejected by canTransition(). */
const TRANSITIONS = Object.freeze({
  [ORDER.PAYMENT_UNDER_VERIFICATION]: [ORDER.CONFIRMED, ORDER.CANCELLED],
  [ORDER.CONFIRMED]: [ORDER.IN_PRODUCTION, ORDER.CANCELLED],
  [ORDER.IN_PRODUCTION]: [ORDER.OUT_FOR_DELIVERY],
  [ORDER.OUT_FOR_DELIVERY]: [ORDER.COMPLETED],
  [ORDER.COMPLETED]: [],
  [ORDER.CANCELLED]: [],
});

/** Admin board moves only (approval owns PUV->CONFIRMED; cancel owns ->CANCELLED). */
const ADMIN_MOVES = Object.freeze([
  ORDER.IN_PRODUCTION,
  ORDER.OUT_FOR_DELIVERY,
  ORDER.COMPLETED,
]);

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

/** Customer cancel window: before production starts. UI + API both enforce. */
function cancellableByCustomer(status) {
  return status === ORDER.PAYMENT_UNDER_VERIFICATION || status === ORDER.CONFIRMED;
}

/** Stock was deducted at approval, so only Confirmed cancels return stock. */
function cancelReturnsStock(status) {
  return status === ORDER.CONFIRMED;
}

module.exports = {
  ORDER,
  REFUND,
  PAYMENT_STAGE,
  PAYMENT_CHANNEL,
  WALLET,
  TRANSITIONS,
  ADMIN_MOVES,
  canTransition,
  cancellableByCustomer,
  cancelReturnsStock,
};
