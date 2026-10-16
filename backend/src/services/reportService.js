/**
 * Sales reports: daily / weekly / monthly / custom JSON + PDF export.
 *
 * DEFINITIONS (accounting rules):
 * - Booked Sales: total gross value of all orders placed in the period (online orders
 *   with status != 'CANCELLED' + walk-in sales placed in the period).
 * - Cash Collected: all payments actually received in the period (verified downpayments
 *   + verified balance payments + walk-in cash sales received in the period).
 * - Outstanding Balance: unpaid balance due on orders placed in the period (booked sales
 *   minus payments made on those orders).
 * - Refunds: total approved and processed refund amount in the period (status = 'REFUNDED').
 * - Net Revenue: Cash Collected minus Refunds (formula: Net Revenue = Cash Collected - Refunds).
 *
 * DATE BOUNDARIES:
 * - All date boundaries use Asia/Manila timezone (UTC+8).
 * - Internally queried as [from, to) half-open date interval (inclusive start, exclusive end).
 * - Displayed to user and in PDF as human-formatted inclusive dates (e.g. "Oct 12 – Oct 18, 2026").
 */

'use strict';

const PDFDocument = require('pdfkit');
const { query } = require('../config/db');
const { formatPesos } = require('../utils/money');

const TZ = 'Asia/Manila';

function pad(n) {
  return String(n).padStart(2, '0');
}

function getManilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function parseDateYmd(str) {
  if (!str) return null;
  const parts = str.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function formatUtcYmd(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDaysUtc(d, n) {
  const res = new Date(d.getTime());
  res.setUTCDate(res.getUTCDate() + n);
  return res;
}

function formatHumanDate(d) {
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatHumanMonth(d) {
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
}

/**
 * Period -> { from, to, display_from, display_to, label, prevFrom, prevTo, comparison_label }
 */
function rangeFor(period = 'today', anchorStr, customOptions = {}) {
  const normPeriod = (period || 'today').toLowerCase();
  const manilaTodayStr = getManilaToday();
  const baseStr = anchorStr || manilaTodayStr;
  const anchorDate = parseDateYmd(baseStr) || parseDateYmd(manilaTodayStr);

  if (normPeriod === 'today' || normPeriod === 'daily') {
    const from = formatUtcYmd(anchorDate);
    const to = formatUtcYmd(addDaysUtc(anchorDate, 1));
    const prevDate = addDaysUtc(anchorDate, -1);
    const dayName = anchorDate.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
    return {
      period: 'today',
      from,
      to,
      display_from: from,
      display_to: from,
      label: `${dayName}, ${formatHumanDate(anchorDate)}`,
      prevFrom: formatUtcYmd(prevDate),
      prevTo: from,
      comparison_label: 'vs yesterday',
    };
  }

  if (normPeriod === 'yesterday') {
    const yesterday = addDaysUtc(anchorDate, -1);
    const from = formatUtcYmd(yesterday);
    const to = formatUtcYmd(anchorDate);
    const dayBefore = addDaysUtc(yesterday, -1);
    const dayName = yesterday.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
    return {
      period: 'yesterday',
      from,
      to,
      display_from: from,
      display_to: from,
      label: `${dayName}, ${formatHumanDate(yesterday)}`,
      prevFrom: formatUtcYmd(dayBefore),
      prevTo: from,
      comparison_label: 'vs previous day',
    };
  }

  if (normPeriod === 'weekly') {
    // Monday-start week: JS Sunday=0 -> (day + 6) % 7 yields 0 for Monday.
    const dayOfWeek = (anchorDate.getUTCDay() + 6) % 7;
    const monday = addDaysUtc(anchorDate, -dayOfWeek);
    const sunday = addDaysUtc(monday, 6);
    const nextMonday = addDaysUtc(monday, 7);
    const prevMonday = addDaysUtc(monday, -7);
    return {
      period: 'weekly',
      from: formatUtcYmd(monday),
      to: formatUtcYmd(nextMonday),
      display_from: formatUtcYmd(monday),
      display_to: formatUtcYmd(sunday),
      label: `${formatHumanDate(monday)} – ${formatHumanDate(sunday)}`,
      prevFrom: formatUtcYmd(prevMonday),
      prevTo: formatUtcYmd(monday),
      comparison_label: 'vs previous week',
    };
  }

  if (normPeriod === 'monthly') {
    const first = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + 1, 1));
    const lastDay = addDaysUtc(nextMonth, -1);
    const prevFirst = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() - 1, 1));
    return {
      period: 'monthly',
      from: formatUtcYmd(first),
      to: formatUtcYmd(nextMonth),
      display_from: formatUtcYmd(first),
      display_to: formatUtcYmd(lastDay),
      label: formatHumanMonth(first),
      prevFrom: formatUtcYmd(prevFirst),
      prevTo: formatUtcYmd(first),
      comparison_label: 'vs previous month',
    };
  }

  if (normPeriod === 'last7days') {
    const startDate = addDaysUtc(anchorDate, -6);
    const nextDay = addDaysUtc(anchorDate, 1);
    const prevStart = addDaysUtc(startDate, -7);
    return {
      period: 'last7days',
      from: formatUtcYmd(startDate),
      to: formatUtcYmd(nextDay),
      display_from: formatUtcYmd(startDate),
      display_to: formatUtcYmd(anchorDate),
      label: `${formatHumanDate(startDate)} – ${formatHumanDate(anchorDate)}`,
      prevFrom: formatUtcYmd(prevStart),
      prevTo: formatUtcYmd(startDate),
      comparison_label: 'vs previous 7 days',
    };
  }

  if (normPeriod === 'custom') {
    const customFrom = customOptions.from ? parseDateYmd(customOptions.from) : anchorDate;
    const customTo = customOptions.to ? parseDateYmd(customOptions.to) : anchorDate;
    const start = customFrom <= customTo ? customFrom : customTo;
    const end = customFrom <= customTo ? customTo : customFrom;
    const nextDay = addDaysUtc(end, 1);
    const durationDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const prevStart = addDaysUtc(start, -durationDays);

    const fromStr = formatUtcYmd(start);
    const toStr = formatUtcYmd(end);
    const label = fromStr === toStr
      ? formatHumanDate(start)
      : `${formatHumanDate(start)} – ${formatHumanDate(end)}`;

    return {
      period: 'custom',
      from: fromStr,
      to: formatUtcYmd(nextDay),
      display_from: fromStr,
      display_to: toStr,
      label,
      prevFrom: formatUtcYmd(prevStart),
      prevTo: fromStr,
      comparison_label: `vs previous ${durationDays} days`,
    };
  }

  // Fallback to daily
  return rangeFor('today', anchorStr);
}

/**
 * Execute aggregated sales metrics for a [from, to) window.
 */
async function queryPeriodMetrics(from, to) {
  const [onlineOrdersRes, walkinRes, paymentsRes, refundsRes] = await Promise.all([
    query(`
      SELECT id, order_code, customer_name, customer_email, customer_contact, status,
             subtotal_centavos, total_centavos, downpayment_centavos, downpayment_paid_centavos,
             balance_due_centavos, payment_method, created_at
        FROM orders
       WHERE (created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
         AND (created_at AT TIME ZONE 'Asia/Manila')::date < $2::date
         AND status != 'CANCELLED'
       ORDER BY created_at DESC;
    `, [from, to]),

    query(`
      SELECT id, sale_code, total_centavos, cash_received_centavos, change_centavos,
             created_by, created_at
        FROM walkin_sales
       WHERE (created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
         AND (created_at AT TIME ZONE 'Asia/Manila')::date < $2::date
       ORDER BY created_at DESC;
    `, [from, to]),

    query(`
      SELECT p.id, p.order_id, o.order_code, o.customer_name, p.stage, p.channel,
             p.amount_centavos, p.reference_number, p.verification_status,
             COALESCE(p.verified_at, p.created_at) AS collected_at
        FROM payments p
        JOIN orders o ON o.id = p.order_id
       WHERE p.verification_status = 'VERIFIED'
         AND (COALESCE(p.verified_at, p.created_at) AT TIME ZONE 'Asia/Manila')::date >= $1::date
         AND (COALESCE(p.verified_at, p.created_at) AT TIME ZONE 'Asia/Manila')::date < $2::date
         AND o.status != 'CANCELLED'
       ORDER BY collected_at DESC;
    `, [from, to]),

    query(`
      SELECT id, order_id, refund_amount_centavos, status, requested_at, processed_at
        FROM refund_requests
       WHERE status = 'REFUNDED'
         AND (processed_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
         AND (processed_at AT TIME ZONE 'Asia/Manila')::date < $2::date;
    `, [from, to]),
  ]);

  const onlineOrders = onlineOrdersRes.rows;
  const walkinSales = walkinRes.rows;
  const payments = paymentsRes.rows;
  const refunds = refundsRes.rows;

  const onlineBookedGross = onlineOrders.reduce((sum, o) => sum + (o.total_centavos || 0), 0);
  const walkinGross = walkinSales.reduce((sum, w) => sum + (w.total_centavos || 0), 0);
  const bookedSales = onlineBookedGross + walkinGross;

  const downpaymentsCollected = payments
    .filter((p) => p.stage === 'DOWNPAYMENT')
    .reduce((sum, p) => sum + (p.amount_centavos || 0), 0);

  const balancesCollected = payments
    .filter((p) => p.stage === 'BALANCE')
    .reduce((sum, p) => sum + (p.amount_centavos || 0), 0);

  const onlineCollected = downpaymentsCollected + balancesCollected;
  const walkinCollected = walkinGross;
  const cashCollected = onlineCollected + walkinCollected;

  const refundsTotal = refunds.reduce((sum, r) => sum + (r.refund_amount_centavos || 0), 0);
  const netRevenue = Math.max(0, cashCollected - refundsTotal);

  const outstandingBalance = onlineOrders.reduce((sum, o) => sum + Math.max(0, o.balance_due_centavos || 0), 0);
  const totalOrders = onlineOrders.length + walkinSales.length;
  const averageOrderValue = totalOrders > 0 ? Math.round(bookedSales / totalOrders) : 0;

  return {
    onlineOrders,
    walkinSales,
    payments,
    refunds,
    onlineBookedGross,
    walkinGross,
    bookedSales,
    downpaymentsCollected,
    balancesCollected,
    onlineCollected,
    walkinCollected,
    cashCollected,
    refundsTotal,
    netRevenue,
    outstandingBalance,
    totalOrders,
    averageOrderValue,
  };
}

/**
 * Primary sales report service function.
 */
async function getSales(period = 'today', anchorStr, customOptions = {}) {
  const range = rangeFor(period, anchorStr, customOptions);
  const { from, to, display_from, display_to, label, prevFrom, prevTo, comparison_label } = range;

  // 1. Current period metrics
  const curr = await queryPeriodMetrics(from, to);

  // 2. Fetch product details for the current period
  const [onlineItemsRes, walkinItemsRes] = await Promise.all([
    query(`
      SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.pieces_per_bundle,
             oi.bundles, oi.unit_price_centavos, oi.line_total_centavos
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE (o.created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
         AND (o.created_at AT TIME ZONE 'Asia/Manila')::date < $2::date
         AND o.status != 'CANCELLED';
    `, [from, to]),

    query(`
      SELECT wsi.id, wsi.sale_id, wsi.product_id, wsi.product_name, wsi.pieces_per_bundle,
             wsi.unit, wsi.qty, wsi.unit_price_centavos, wsi.line_total_centavos
        FROM walkin_sale_items wsi
        JOIN walkin_sales ws ON ws.id = wsi.sale_id
       WHERE (ws.created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
         AND (ws.created_at AT TIME ZONE 'Asia/Manila')::date < $2::date;
    `, [from, to]),
  ]);

  // Merge items into per-product breakdown
  const productMap = new Map();

  for (const item of onlineItemsRes.rows) {
    const key = String(item.product_id || item.product_name);
    const existing = productMap.get(key) || {
      product_id: item.product_id,
      product_name: item.product_name,
      online_bundles: 0,
      walkin_bundles: 0,
      walkin_pieces: 0,
      revenue_centavos: 0,
    };
    existing.online_bundles += item.bundles || 0;
    existing.revenue_centavos += item.line_total_centavos || 0;
    productMap.set(key, existing);
  }

  for (const item of walkinItemsRes.rows) {
    const key = String(item.product_id || item.product_name);
    const existing = productMap.get(key) || {
      product_id: item.product_id,
      product_name: item.product_name,
      online_bundles: 0,
      walkin_bundles: 0,
      walkin_pieces: 0,
      revenue_centavos: 0,
    };
    if (item.unit === 'BUNDLE') {
      existing.walkin_bundles += item.qty || 0;
    } else {
      existing.walkin_pieces += item.qty || 0;
    }
    existing.revenue_centavos += item.line_total_centavos || 0;
    productMap.set(key, existing);
  }

  const denominator = curr.bookedSales || 1;
  const byProduct = [...productMap.values()].map((p) => {
    const totalBundles = p.online_bundles + p.walkin_bundles;
    const sharePct = curr.bookedSales > 0
      ? Number(((p.revenue_centavos / denominator) * 100).toFixed(1))
      : 0;
    return {
      product_id: p.product_id,
      product_name: p.product_name,
      bundles_sold: totalBundles,
      pieces_sold: p.walkin_pieces,
      online_bundles: p.online_bundles,
      walkin_bundles: p.walkin_bundles,
      walkin_pieces: p.walkin_pieces,
      total_centavos: p.revenue_centavos,
      revenue_centavos: p.revenue_centavos,
      share_pct: sharePct,
    };
  }).sort((a, b) => b.total_centavos - a.total_centavos);

  const totalBundlesSold = byProduct.reduce((sum, p) => sum + p.bundles_sold, 0);
  const totalPiecesSold = byProduct.reduce((sum, p) => sum + p.pieces_sold, 0);

  // 3. Transactions list (Orders + Walk-in Sales)
  const transactions = [
    ...curr.onlineOrders.map((o) => ({
      id: o.id,
      code: o.order_code,
      created_at: o.created_at,
      customer: o.customer_name,
      channel: 'ONLINE',
      status: o.status,
      payment_method: o.payment_method,
      amount_centavos: o.total_centavos,
      downpayment_paid_centavos: o.downpayment_paid_centavos,
      balance_centavos: o.balance_due_centavos,
    })),
    ...curr.walkinSales.map((w) => ({
      id: `w-${w.id}`,
      code: w.sale_code,
      created_at: w.created_at,
      customer: 'Counter Walk-In',
      channel: 'WALK_IN',
      status: 'COMPLETED',
      payment_method: 'CASH',
      amount_centavos: w.total_centavos,
      downpayment_paid_centavos: w.total_centavos,
      balance_centavos: 0,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 4. Payments list (Verified payments + Walk-in cash receipts)
  const paymentsList = [
    ...curr.payments.map((p) => ({
      id: p.id,
      order_id: p.order_id,
      order_code: p.order_code,
      customer_name: p.customer_name,
      created_at: p.collected_at,
      stage: p.stage, // DOWNPAYMENT or BALANCE
      channel: p.channel, // GCASH, MAYA, CASH
      reference_number: p.reference_number || '—',
      amount_centavos: p.amount_centavos,
    })),
    ...curr.walkinSales.map((w) => ({
      id: `walkin-pay-${w.id}`,
      order_id: null,
      order_code: w.sale_code,
      customer_name: 'Counter Walk-In',
      created_at: w.created_at,
      stage: 'WALK_IN',
      channel: 'CASH',
      reference_number: w.sale_code,
      amount_centavos: w.total_centavos,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 5. Previous period comparison & deltas
  let deltas = {
    net_revenue_pct: null,
    cash_collected_pct: null,
    booked_sales_pct: null,
    outstanding_balance_pct: null,
    total_orders_pct: null,
  };
  let previous = null;

  try {
    const prev = await queryPeriodMetrics(prevFrom, prevTo);
    previous = {
      net_revenue_centavos: prev.netRevenue,
      cash_collected_centavos: prev.cashCollected,
      booked_sales_centavos: prev.bookedSales,
      outstanding_balance_centavos: prev.outstandingBalance,
      total_orders: prev.totalOrders,
    };

    function calcDelta(currVal, prevVal) {
      if (prevVal === 0) return currVal > 0 ? 100 : 0;
      return Number((((currVal - prevVal) / prevVal) * 100).toFixed(1));
    }

    deltas = {
      net_revenue_pct: calcDelta(curr.netRevenue, prev.netRevenue),
      cash_collected_pct: calcDelta(curr.cashCollected, prev.cashCollected),
      booked_sales_pct: calcDelta(curr.bookedSales, prev.bookedSales),
      outstanding_balance_pct: calcDelta(curr.outstandingBalance, prev.outstandingBalance),
      total_orders_pct: calcDelta(curr.totalOrders, prev.totalOrders),
    };
  } catch (err) {
    console.error('Failed to calculate previous period comparison:', err);
  }

  // 6. Chart datasets
  // Trend chart: Hourly for today/yesterday; Daily for weekly/monthly/custom
  const isHourly = (range.period === 'today' || range.period === 'yesterday');
  const trendBuckets = [];

  if (isHourly) {
    for (let h = 6; h <= 21; h++) {
      const hStr = `${pad(h)}:00`;
      trendBuckets.push({
        label: hStr,
        online_centavos: 0,
        walkin_centavos: 0,
        net_centavos: 0,
      });
    }

    curr.payments.forEach((p) => {
      const d = new Date(p.collected_at);
      const manilaHours = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d);
      const hourNum = parseInt(manilaHours, 10);
      const bucket = trendBuckets.find((b) => b.label.startsWith(pad(hourNum)));
      if (bucket) {
        bucket.online_centavos += p.amount_centavos;
        bucket.net_centavos += p.amount_centavos;
      }
    });

    curr.walkinSales.forEach((w) => {
      const d = new Date(w.created_at);
      const manilaHours = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d);
      const hourNum = parseInt(manilaHours, 10);
      const bucket = trendBuckets.find((b) => b.label.startsWith(pad(hourNum)));
      if (bucket) {
        bucket.walkin_centavos += w.total_centavos;
        bucket.net_centavos += w.total_centavos;
      }
    });
  } else {
    // Daily buckets from display_from to display_to
    const startDate = parseDateYmd(display_from);
    const endDate = parseDateYmd(display_to);
    let iter = new Date(startDate.getTime());

    while (iter <= endDate) {
      const ymd = formatUtcYmd(iter);
      const dayLabel = iter.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
      trendBuckets.push({
        date: ymd,
        label: dayLabel,
        online_centavos: 0,
        walkin_centavos: 0,
        net_centavos: 0,
      });
      iter = addDaysUtc(iter, 1);
    }

    curr.payments.forEach((p) => {
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(p.collected_at));
      const bucket = trendBuckets.find((b) => b.date === ymd);
      if (bucket) {
        bucket.online_centavos += p.amount_centavos;
        bucket.net_centavos += p.amount_centavos;
      }
    });

    curr.walkinSales.forEach((w) => {
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(w.created_at));
      const bucket = trendBuckets.find((b) => b.date === ymd);
      if (bucket) {
        bucket.walkin_centavos += w.total_centavos;
        bucket.net_centavos += w.total_centavos;
      }
    });
  }

  // Channel split
  const channelTotal = (curr.onlineCollected + curr.walkinCollected) || 1;
  const channelSplit = {
    online_centavos: curr.onlineCollected,
    walkin_centavos: curr.walkinCollected,
    online_pct: curr.cashCollected > 0 ? Number(((curr.onlineCollected / channelTotal) * 100).toFixed(1)) : 0,
    walkin_pct: curr.cashCollected > 0 ? Number(((curr.walkinCollected / channelTotal) * 100).toFixed(1)) : 0,
  };

  // Top 5 products
  const topProducts = byProduct.slice(0, 5);

  return {
    period: range.period,
    from,
    to,
    display_from,
    display_to,
    label,
    comparison_label,
    generated_at: new Date().toISOString(),

    // Backwards-compatible contract for dashboard.js and other callers
    online: {
      orders: curr.onlineOrders.length,
      gross_centavos: curr.onlineBookedGross,
      downpayments_collected_centavos: curr.downpaymentsCollected,
      balances_collected_centavos: curr.balancesCollected,
      outstanding_centavos: curr.outstandingBalance,
      collected_centavos: curr.onlineCollected,
    },
    walkin: {
      sales: curr.walkinSales.length,
      gross_centavos: curr.walkinGross,
      collected_centavos: curr.walkinCollected,
    },
    combined_gross_centavos: curr.bookedSales,
    collected_centavos: curr.cashCollected,
    refunded: {
      total_centavos: curr.refundsTotal,
      count: curr.refunds.length,
    },
    net_collected_centavos: curr.netRevenue,

    summary: {
      total_orders: curr.totalOrders,
      online_orders: curr.onlineOrders.length,
      walkin_sales: curr.walkinSales.length,
      online_collected_centavos: curr.downpaymentsCollected,
      balances_collected_centavos: curr.balancesCollected,
      walkin_collected_centavos: curr.walkinCollected,
      collected_centavos: curr.cashCollected,
      net_collected_centavos: curr.netRevenue,
      refunded_centavos: curr.refundsTotal,
      total_bundles: totalBundlesSold,
      total_pieces: totalPiecesSold,
      booked_sales_centavos: curr.bookedSales,
      outstanding_centavos: curr.outstandingBalance,
      payments_count: paymentsList.length,
      aov_centavos: curr.averageOrderValue,
    },

    // Rich metrics & UI data
    metrics: {
      net_revenue_centavos: curr.netRevenue,
      cash_collected_centavos: curr.cashCollected,
      booked_sales_centavos: curr.bookedSales,
      outstanding_balance_centavos: curr.outstandingBalance,
      refunds_centavos: curr.refundsTotal,
      refunds_count: curr.refunds.length,
      online_booked_centavos: curr.onlineBookedGross,
      walkin_booked_centavos: curr.walkinGross,
      online_collected_centavos: curr.onlineCollected,
      walkin_collected_centavos: curr.walkinCollected,
      total_orders: curr.totalOrders,
      online_orders: curr.onlineOrders.length,
      walkin_sales: curr.walkinSales.length,
      payments_count: paymentsList.length,
      total_bundles: totalBundlesSold,
      total_pieces: totalPiecesSold,
      aov_centavos: curr.averageOrderValue,
    },

    previous,
    deltas,

    charts: {
      is_hourly: isHourly,
      trend: trendBuckets,
      channel_split: channelSplit,
      top_products: topProducts,
    },

    by_product: byProduct,
    per_product: byProduct,
    transactions,
    payments: paymentsList,
  };
}

/**
 * Render printable PDF report from the report object.
 */
function renderPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 88;
    const money = (c) => formatPesos(c);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#3E241B')
      .text('WeBake - Sales & Revenue Report', { align: 'left' });
    doc.fontSize(11).font('Helvetica').fillColor('#7A685D')
      .text(`Crumbs N' Rolls Bakery  |  Period: ${report.label}`);
    doc.moveDown(0.4);
    doc.moveTo(44, doc.y).lineTo(44 + W, doc.y).strokeColor('#E6D7C8').stroke();
    doc.moveDown(0.8);

    // Summary block
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#3E241B').text('Executive Summary');
    doc.moveDown(0.3);
    const rows = [
      ['Net Revenue (Cash - Refunds)', '', money(report.net_collected_centavos)],
      ['Cash Collected (Payments)', `${report.summary.payments_count || 0} payments`, money(report.collected_centavos)],
      ['Booked Sales (Orders Placed)', `${report.summary.total_orders} orders/sales`, money(report.combined_gross_centavos)],
      ['Outstanding Balance (Unpaid)', '', money(report.summary.outstanding_centavos || 0)],
      ['Online Downpayments Collected', '', money(report.online.downpayments_collected_centavos)],
      ['Online Balances Collected', '', money(report.online.balances_collected_centavos)],
      ['Walk-in Cash Sales', `${report.walkin.sales} sales`, money(report.walkin.gross_centavos)],
      [`Refunds Processed (${report.refunded.count})`, '', money(report.refunded.total_centavos)],
    ];
    const rowH = 19;
    rows.forEach(([label, mid, val], i) => {
      const y = doc.y;
      if (i === 0) {
        doc.rect(44, y - 3, W, rowH + 2).fillColor('#FAF3E8').fill();
      }
      doc.fillColor('#3E241B').font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(label, 50, y, { width: 230 });
      doc.text(mid, 280, y, { width: 110 });
      doc.text(val, 390, y, { width: 150, align: 'right' });
      doc.y = y + rowH;
      if (i < rows.length - 1) {
        doc.moveTo(44, doc.y - 4).lineTo(44 + W, doc.y - 4).strokeColor('#F0E6DD').stroke();
      }
    });
    doc.moveDown(1);

    // Per-product table
    if (doc.y > 640) doc.addPage();
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#3E241B').text('Sales By Product Breakdown');
    doc.moveDown(0.4);
    const cols = [44, 250, 330, 410, 485]; // x positions
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#7A685D');
    doc.text('PRODUCT', cols[0], doc.y);
    doc.text('ONLINE (BDL)', cols[1], doc.y);
    doc.text('WALK-IN (BDL)', cols[2], doc.y);
    doc.text('WALK-IN (PCS)', cols[3], doc.y);
    doc.text('TOTAL SALES', cols[4], doc.y, { width: 65, align: 'right' });
    doc.moveDown(0.6);
    doc.moveTo(44, doc.y).lineTo(44 + W, doc.y).strokeColor('#B5523A').stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).fillColor('#3E241B');

    for (const p of report.by_product) {
      if (doc.y > 750) {
        doc.addPage();
        doc.font('Helvetica').fontSize(10).fillColor('#3E241B');
      }
      const y = doc.y;
      doc.text(p.product_name.slice(0, 28), cols[0], y, { width: 200 });
      doc.text(String(p.online_bundles), cols[1], y);
      doc.text(String(p.walkin_bundles), cols[2], y);
      doc.text(String(p.walkin_pieces), cols[3], y);
      doc.text(money(p.total_centavos), cols[4], y, { width: 65, align: 'right' });
      doc.y = y + 17;
    }

    if (report.by_product.length === 0) {
      doc.fillColor('#7A685D').text('No products were sold during this period.');
    }

    // Footer
    doc.moveDown(1.5);
    const genDate = new Date(report.generated_at).toLocaleString('en-PH', { timeZone: TZ });
    doc.fontSize(8).fillColor('#7A685D')
      .text(`Generated on ${genDate} (Asia/Manila)  |  Store: Crumbs N' Rolls Bakery  |  All amounts in PHP (₱)`,
        { align: 'center' });

    doc.end();
  });
}

module.exports = { rangeFor, getSales, renderPdf };
