/**
 * Sales reports: daily / weekly / monthly JSON + PDF export.
 *
 * WHAT: getSales() aggregates one period; renderPdf() turns the same object
 * into a printable PDF. One data function feeds both outputs, so the screen
 * and the export can never disagree.
 *
 * ACCOUNTING RULES (spec): cancelled orders are EXCLUDED everywhere; refunded
 * money appears as its own line (never silently netted). "Collected" means
 * money actually in hand: verified downpayments + recorded cash balances.
 * Net collected = collected - refunded.
 */

'use strict';

const PDFDocument = require('pdfkit');
const { query } = require('../config/db');
const { formatPesos } = require('../utils/money');

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Period -> half-open [from, to) day range + human label. */
function rangeFor(period, anchorStr) {
  const anchor = anchorStr ? new Date(`${anchorStr}T00:00:00`) : new Date();
  if (Number.isNaN(anchor.getTime())) {
    throw Object.assign(new Error('Invalid anchor date.'), {
      status: 400, code: 'VALIDATION_ERROR',
      message: 'Anchor must be a valid date (YYYY-MM-DD).',
      message_en: 'Anchor must be a valid date (YYYY-MM-DD).',
    });
  }
  if (period === 'weekly') {
    // Monday-start weeks: JS Sunday=0 -> shift so Monday=0.
    const monday = addDays(anchor, -((anchor.getDay() + 6) % 7));
    return { from: isoDay(monday), to: isoDay(addDays(monday, 7)), label: `Week of ${isoDay(monday)}` };
  }
  if (period === 'monthly') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    return { from: isoDay(first), to: isoDay(next), label: `${first.toLocaleString('en-US', { month: 'long', year: 'numeric' })}` };
  }
  return { from: isoDay(anchor), to: isoDay(addDays(anchor, 1)), label: isoDay(anchor) };
}

async function getSales(period, anchorStr) {
  const { from, to, label } = rangeFor(period, anchorStr);

  const [online, walkin, balances, perOnline, perWalkin, refunds] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n,
                  COALESCE(SUM(total_centavos), 0)::int AS gross,
                  COALESCE(SUM(downpayment_paid_centavos), 0)::int AS down_collected,
                  COALESCE(SUM(balance_due_centavos), 0)::int AS outstanding
             FROM orders
            WHERE (created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
              AND (created_at AT TIME ZONE 'Asia/Manila')::date < $2::date
              AND status IN ('CONFIRMED', 'IN_PRODUCTION', 'OUT_FOR_DELIVERY', 'COMPLETED');`, [from, to]),
    query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_centavos), 0)::int AS gross
             FROM walkin_sales
            WHERE (created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
              AND (created_at AT TIME ZONE 'Asia/Manila')::date < $2::date;`, [from, to]),
    query(`SELECT COALESCE(SUM(amount_centavos), 0)::int AS collected
             FROM payments
            WHERE stage = 'BALANCE' AND verification_status = 'VERIFIED'
              AND (created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
              AND (created_at AT TIME ZONE 'Asia/Manila')::date < $2::date;`, [from, to]),
    query(`SELECT oi.product_id, oi.product_name,
                  COALESCE(SUM(oi.bundles), 0)::int AS bundles,
                  COALESCE(SUM(oi.line_total_centavos), 0)::int AS revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE (o.created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
              AND (o.created_at AT TIME ZONE 'Asia/Manila')::date < $2::date
              AND o.status IN ('CONFIRMED', 'IN_PRODUCTION', 'OUT_FOR_DELIVERY', 'COMPLETED')
             GROUP BY oi.product_id, oi.product_name
             ORDER BY revenue DESC;`, [from, to]),
    query(`SELECT product_id, product_name,
                  COALESCE(SUM(CASE WHEN unit = 'BUNDLE' THEN qty ELSE 0 END), 0)::int AS bundles,
                  COALESCE(SUM(CASE WHEN unit = 'PIECE' THEN qty ELSE 0 END), 0)::int AS pieces,
                  COALESCE(SUM(line_total_centavos), 0)::int AS revenue
             FROM walkin_sale_items wsi
             JOIN walkin_sales ws ON ws.id = wsi.sale_id
            WHERE (ws.created_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
              AND (ws.created_at AT TIME ZONE 'Asia/Manila')::date < $2::date
            GROUP BY product_id, product_name
            ORDER BY revenue DESC;`, [from, to]),
    query(`SELECT COALESCE(SUM(refund_amount_centavos), 0)::int AS total,
                  COUNT(*)::int AS n
             FROM refund_requests
            WHERE status = 'REFUNDED'
              AND (processed_at AT TIME ZONE 'Asia/Manila')::date >= $1::date
              AND (processed_at AT TIME ZONE 'Asia/Manila')::date < $2::date;`, [from, to]),
  ]);

  // Merge online + walk-in per-product rows by product_id (name fallback).
  const merged = new Map();
  for (const r of perOnline.rows) {
    merged.set(`o${r.product_id}-${r.product_name}`, {
      product_id: r.product_id, product_name: r.product_name,
      online_bundles: r.bundles, walkin_bundles: 0, walkin_pieces: 0,
      revenue_centavos: r.revenue,
    });
  }
  for (const r of perWalkin.rows) {
    const key = `o${r.product_id}-${r.product_name}`;
    const row = merged.get(key) || {
      product_id: r.product_id, product_name: r.product_name,
      online_bundles: 0, walkin_bundles: 0, walkin_pieces: 0, revenue_centavos: 0,
    };
    row.walkin_bundles += r.bundles;
    row.walkin_pieces += r.pieces;
    row.revenue_centavos += r.revenue;
    merged.set(key, row);
  }
  const perProduct = [...merged.values()].sort((a, b) => b.revenue_centavos - a.revenue_centavos);

  const o = online.rows[0];
  const w = walkin.rows[0];
  const collected = o.down_collected + balances.rows[0].collected;
  const refunded = refunds.rows[0];

  return {
    period, from, to, label,
    generated_at: new Date().toISOString(),
    online: {
      orders: o.n, gross_centavos: o.gross,
      downpayments_collected_centavos: o.down_collected,
      balances_collected_centavos: balances.rows[0].collected,
      outstanding_centavos: o.outstanding,
    },
    walkin: { sales: w.n, gross_centavos: w.gross },
    combined_gross_centavos: o.gross + w.gross,
    collected_centavos: collected,
    refunded: { total_centavos: refunded.total, count: refunded.n },
    net_collected_centavos: collected - refunded.total,
    per_product: perProduct,
  };
}

/** Render the report object to a PDF buffer (A4, printable). */
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
      .text('WeBake - Sales Report', { align: 'left' });
    doc.fontSize(11).font('Helvetica').fillColor('#7A685D')
      .text(`Crumbs N' Rolls Bakery  |  ${report.period.toUpperCase()}  |  ${report.label}`);
    doc.moveDown(0.4);
    doc.moveTo(44, doc.y).lineTo(44 + W, doc.y).strokeColor('#E6D7C8').stroke();
    doc.moveDown(0.8);

    // Summary block
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#3E241B').text('Summary');
    doc.moveDown(0.3);
    const rows = [
      ['Online orders', `${report.online.orders} orders`, money(report.online.gross_centavos)],
      ['Walk-in sales', `${report.walkin.sales} sales`, money(report.walkin.gross_centavos)],
      ['Combined gross', '', money(report.combined_gross_centavos)],
      ['Downpayments collected', '', money(report.online.downpayments_collected_centavos)],
      ['Balances collected (cash)', '', money(report.online.balances_collected_centavos)],
      ['Outstanding balances', '', money(report.online.outstanding_centavos)],
      [`Refunded (${report.refunded.count})`, '', money(report.refunded.total_centavos)],
      ['NET COLLECTED', '', money(report.net_collected_centavos)],
    ];
    const rowH = 19;
    rows.forEach(([label, mid, val], i) => {
      const y = doc.y;
      if (i === rows.length - 1) {
        doc.rect(44, y - 3, W, rowH + 2).fillColor('#FAF3E8').fill();
      }
      doc.fillColor('#3E241B').font(i === rows.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(label, 50, y, { width: 220 });
      doc.text(mid, 270, y, { width: 120 });
      doc.text(val, 390, y, { width: 150, align: 'right' });
      doc.y = y + rowH;
      if (i < rows.length - 1) {
        doc.moveTo(44, doc.y - 4).lineTo(44 + W, doc.y - 4).strokeColor('#F0E6DD').stroke();
      }
    });
    doc.moveDown(1);

    // Per-product table
    if (doc.y > 660) doc.addPage();
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#3E241B').text('Per-product breakdown');
    doc.moveDown(0.4);
    const cols = [44, 250, 330, 410, 490]; // x positions
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#7A685D');
    doc.text('PRODUCT', cols[0], doc.y);
    doc.text('ONLINE (BDL)', cols[1], doc.y);
    doc.text('WALK-IN (BDL)', cols[2], doc.y);
    doc.text('WALK-IN (PCS)', cols[3], doc.y);
    doc.text('REVENUE', cols[4], doc.y, { width: 60, align: 'right' });
    doc.moveDown(0.6);
    doc.moveTo(44, doc.y).lineTo(44 + W, doc.y).strokeColor('#B5523A').stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).fillColor('#3E241B');
    for (const p of report.per_product) {
      if (doc.y > 750) {
        doc.addPage();
        doc.font('Helvetica').fontSize(10).fillColor('#3E241B');
      }
      const y = doc.y;
      doc.text(p.product_name.slice(0, 28), cols[0], y, { width: 200 });
      doc.text(String(p.online_bundles), cols[1], y);
      doc.text(String(p.walkin_bundles), cols[2], y);
      doc.text(String(p.walkin_pieces), cols[3], y);
      doc.text(money(p.revenue_centavos), cols[4], y, { width: 60, align: 'right' });
      doc.y = y + 17;
    }
    if (report.per_product.length === 0) {
      doc.fillColor('#7A685D').text('No sales in this period.');
    }

    // Footer
    doc.moveDown(1.5);
    doc.fontSize(8).fillColor('#7A685D')
      .text(`Generated ${new Date(report.generated_at).toLocaleString('en-PH')}  |  ` +
        'Cancelled orders excluded  |  Refunds shown separately, netted only in NET COLLECTED.',
        { align: 'center' });

    doc.end();
  });
}

module.exports = { rangeFor, getSales, renderPdf };
