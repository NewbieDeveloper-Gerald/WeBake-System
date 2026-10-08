/**
 * Dashboard service: one aggregated payload for the admin home screen.
 *
 * WHAT: Today's online + walk-in sales, verification queue depth, orders by
 * status, low-stock list, recent orders, refund alert counts, outstanding
 * balances. Single endpoint, parallel queries - the admin UI renders without
 * a waterfall of requests.
 */

'use strict';

const { query } = require('../config/db');
const inventoryService = require('./inventoryService');

async function stats() {
  const [
    todayOnline, todayWalkin, pending, byStatus, recent, refunds, outstanding,
  ] = await Promise.all([
    query(`SELECT COALESCE(SUM(total_centavos), 0)::int AS gross,
                  COUNT(*)::int AS n
             FROM orders
            WHERE created_at::date = CURRENT_DATE
              AND status IN ('CONFIRMED', 'IN_PRODUCTION', 'OUT_FOR_DELIVERY', 'COMPLETED');`),
    query(`SELECT COALESCE(SUM(total_centavos), 0)::int AS gross,
                  COUNT(*)::int AS n
             FROM walkin_sales WHERE created_at::date = CURRENT_DATE;`),
    query(`SELECT COUNT(*)::int AS n FROM orders WHERE status = 'PAYMENT_UNDER_VERIFICATION';`),
    query(`SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status;`),
    query(`SELECT order_code, customer_name, total_centavos, status, created_at
             FROM orders ORDER BY created_at DESC LIMIT 8;`),
    query(`SELECT status, COUNT(*)::int AS n FROM refund_requests GROUP BY status;`),
    query(`SELECT COALESCE(SUM(balance_due_centavos), 0)::int AS total
             FROM orders WHERE status NOT IN ('CANCELLED', 'COMPLETED');`),
  ]);

  const refundCounts = Object.fromEntries(refunds.rows.map((r) => [r.status, r.n]));
  const alertCount = (refundCounts.AWAITING_DETAILS || 0) + (refundCounts.PENDING || 0);
  const lowStock = await inventoryService.lowStock();

  return {
    sales_today: {
      online_gross_centavos: todayOnline.rows[0].gross,
      online_count: todayOnline.rows[0].n,
      walkin_gross_centavos: todayWalkin.rows[0].gross,
      walkin_count: todayWalkin.rows[0].n,
    },
    pending_verification: pending.rows[0].n,
    orders_by_status: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
    recent_orders: recent.rows,
    refunds: { alert_count: alertCount, by_status: refundCounts },
    outstanding_balances_centavos: outstanding.rows[0].total,
    low_stock: lowStock,
  };
}

module.exports = { stats };
