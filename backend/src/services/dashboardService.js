/**
 * Dashboard service: one aggregated payload for the admin home screen.
 *
 * WHAT: Today's online + walk-in sales, verification queue depth, orders by
 * status, low-stock list, recent orders, refund alert counts, outstanding
 * balances. Single endpoint, parallel queries - the admin UI renders without
 * a waterfall of requests.
 */

'use strict';

const { query, getClient } = require('../config/db');
const inventoryService = require('./inventoryService');
const alertService = require('./alertService');

async function stats() {
  const client = await getClient();
  try {
    const todayDownpayments = await client.query(`SELECT COALESCE(SUM(p.amount_centavos), 0)::int AS collected,
                  COUNT(DISTINCT o.id)::int AS order_count
             FROM payments p
             JOIN orders o ON o.id = p.order_id
            WHERE p.stage = 'DOWNPAYMENT'
              AND p.verification_status = 'VERIFIED'
              AND (COALESCE(p.verified_at, p.created_at) AT TIME ZONE 'Asia/Manila')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
              AND o.status != 'CANCELLED';`);

    const todayBalances = await client.query(`SELECT COALESCE(SUM(p.amount_centavos), 0)::int AS collected,
                  COUNT(*)::int AS payment_count
             FROM payments p
             JOIN orders o ON o.id = p.order_id
            WHERE p.stage = 'BALANCE'
              AND p.verification_status = 'VERIFIED'
              AND (COALESCE(p.verified_at, p.created_at) AT TIME ZONE 'Asia/Manila')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
              AND o.status != 'CANCELLED';`);

    const todayRefunds = await client.query(`SELECT COALESCE(SUM(refund_amount_centavos), 0)::int AS refunded_today
             FROM refund_requests
            WHERE status = 'REFUNDED'
              AND (processed_at AT TIME ZONE 'Asia/Manila')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;`);

    const todayWalkin = await client.query(`SELECT COALESCE(SUM(total_centavos), 0)::int AS gross,
                  COUNT(*)::int AS n
             FROM walkin_sales
            WHERE (created_at AT TIME ZONE 'Asia/Manila')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;`);

    const pending = await client.query(`SELECT COUNT(*)::int AS n FROM orders WHERE status = 'PAYMENT_UNDER_VERIFICATION';`);

    const byStatus = await client.query(`SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status;`);

    const recent = await client.query(`SELECT order_code, customer_name, total_centavos, status, created_at
             FROM orders ORDER BY created_at DESC LIMIT 10;`);

    // Refund metrics: counts, total pending amount, oldest pending request, and recent pending list
    const refundStats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending_count,
        COUNT(*) FILTER (WHERE status = 'AWAITING_DETAILS')::int AS awaiting_count,
        COALESCE(SUM(refund_amount_centavos) FILTER (WHERE status IN ('PENDING', 'AWAITING_DETAILS')), 0)::bigint AS pending_amount_centavos,
        MIN(requested_at) FILTER (WHERE status IN ('PENDING', 'AWAITING_DETAILS')) AS oldest_pending_requested_at
      FROM refund_requests;
    `);

    const recentPendingRefunds = await client.query(`
      SELECT r.id, r.order_id, o.order_code, o.customer_name, r.refund_amount_centavos,
             r.status, r.requested_at
        FROM refund_requests r
        JOIN orders o ON o.id = r.order_id
       WHERE r.status IN ('PENDING', 'AWAITING_DETAILS')
       ORDER BY r.requested_at ASC
       LIMIT 3;
    `);

    const refunds = await client.query(`SELECT status, COUNT(*)::int AS n FROM refund_requests GROUP BY status;`);
    const refundCounts = Object.fromEntries(refunds.rows.map((r) => [r.status, r.n]));
    const refRow = refundStats.rows[0] || {};
    const pendingRefundsCount = (refRow.pending_count || 0) + (refRow.awaiting_count || 0);

    const outstanding = await client.query(`SELECT COALESCE(SUM(GREATEST(0, o.downpayment_centavos - o.downpayment_paid_centavos)), 0)::int AS total
             FROM orders o WHERE o.status NOT IN ('CANCELLED', 'COMPLETED');`);

    // Unified stock alerts (single source of truth for both products & ingredients)
    const stockAlerts = await alertService.getStockAlerts(client);

    const onlineDownpayment = todayDownpayments.rows[0].collected;
    const balanceCollected = todayBalances.rows[0].collected;
    const walkinGross = todayWalkin.rows[0].gross;
    const refundedToday = todayRefunds.rows[0].refunded_today;
    const combinedToday = Math.max(0, onlineDownpayment + walkinGross + balanceCollected - refundedToday);

    return {
      sales_today: {
        combined_centavos: combinedToday,
        online_downpayment_centavos: onlineDownpayment,
        online_collected_centavos: onlineDownpayment,
        online_gross_centavos: onlineDownpayment,
        online_count: todayDownpayments.rows[0].order_count,
        walkin_gross_centavos: walkinGross,
        walkin_collected_centavos: walkinGross,
        walkin_count: todayWalkin.rows[0].n,
        collected_balance_centavos: balanceCollected,
        collected_balance_count: todayBalances.rows[0].payment_count,
      },
      pending_verification: pending.rows[0].n,
      orders_by_status: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
      recent_orders: recent.rows,
      refunds: {
        alert_count: pendingRefundsCount,
        pending_count: pendingRefundsCount,
        pending_amount_centavos: Number(refRow.pending_amount_centavos || 0),
        oldest_pending_requested_at: refRow.oldest_pending_requested_at,
        recent_pending: recentPendingRefunds.rows,
        by_status: refundCounts,
      },
      outstanding_balances_centavos: outstanding.rows[0].total,
      possible_collection_centavos: outstanding.rows[0].total,
      alerts: stockAlerts,
      low_stock: stockAlerts.products,
      low_stock_ingredients: stockAlerts.ingredients,
    };
  } finally {
    client.release();
  }
}

module.exports = { stats };
