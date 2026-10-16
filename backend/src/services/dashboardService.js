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

    const refunds = await client.query(`SELECT status, COUNT(*)::int AS n FROM refund_requests GROUP BY status;`);

    const outstanding = await client.query(`SELECT COALESCE(SUM(GREATEST(0, o.downpayment_centavos - o.downpayment_paid_centavos)), 0)::int AS total
             FROM orders o WHERE o.status NOT IN ('CANCELLED', 'COMPLETED');`);

    let lowStockIngredients = { rows: [] };
    try {
      lowStockIngredients = await client.query(`SELECT id, name, stock_quantity, unit, reorder_level, stock_status
             FROM public.ingredient_stock_status
            WHERE stock_status IN ('low_stock', 'out_of_stock')
            ORDER BY stock_quantity ASC;`);
    } catch (_) {}

    const refundCounts = Object.fromEntries(refunds.rows.map((r) => [r.status, r.n]));
    const alertCount = (refundCounts.AWAITING_DETAILS || 0) + (refundCounts.PENDING || 0);
    const lowStock = await inventoryService.lowStock();

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
      refunds: { alert_count: alertCount, by_status: refundCounts },
      outstanding_balances_centavos: outstanding.rows[0].total,
      possible_collection_centavos: outstanding.rows[0].total,
      low_stock: lowStock,
      low_stock_ingredients: lowStockIngredients ? lowStockIngredients.rows : [],
    };
  } finally {
    client.release();
  }
}

module.exports = { stats };
