/**
 * Walk-in POS service: counter sales by bundle or piece.
 *
 * WHAT: One atomic sale: lock products -> price from catalog -> check stock ->
 * deduct (+POS_SALE movements) -> verify cash covers total -> record sale +
 * items -> receipt. Paid in full, cash only, no downpayment (spec).
 *
 * STOCK MATH: bundles consume qty*pieces_per_bundle pieces; pieces consume
 * qty pieces. Both draw from the same stock_pieces counter as online orders,
 * so the shelf count is always truthful.
 */

'use strict';

const crypto = require('crypto');
const { getClient } = require('../config/db');
const { conflict, notFound } = require('../utils/serviceError');

async function createSale(items, cashReceived, actor) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock every product first (id order: deadlock-safe), then price + check.
    const ids = [...new Set(items.map((i) => i.product_id))].sort((a, b) => a - b);
    const { rows } = await client.query(
      'SELECT * FROM products WHERE id = ANY($1::bigint[]) FOR UPDATE;',
      [ids]
    );
    // PostgreSQL BIGINT IDs are strings; request IDs are validated numbers.
    const byId = new Map(rows.map((p) => [Number(p.id), p]));

    let total = 0;
    const lines = [];
    const requiredPiecesByProduct = new Map();
    for (const item of items) {
      const product = byId.get(item.product_id);
      if (!product || product.is_archived) {
        throw notFound('A product in this sale is no longer available.',
          'Ang isang produkto ay hindi na available.');
      }
      const pieces = item.unit === 'BUNDLE'
        ? item.qty * product.pieces_per_bundle
        : item.qty;
      const unitPrice = item.unit === 'BUNDLE'
        ? product.price_bundle_centavos
        : product.piece_price_centavos;
      const productId = Number(product.id);
      requiredPiecesByProduct.set(productId,
        (requiredPiecesByProduct.get(productId) || 0) + pieces);
      const lineTotal = unitPrice * item.qty;
      total += lineTotal;
      lines.push({
        product_id: product.id, product_name: product.name,
        pieces_per_bundle: product.pieces_per_bundle, unit: item.unit,
        qty: item.qty, unit_price_centavos: unitPrice,
        line_total_centavos: lineTotal, pieces,
      });
    }

    for (const [productId, requiredPieces] of requiredPiecesByProduct) {
      const product = byId.get(productId);
      if (product.stock_pieces < requiredPieces) {
        throw conflict('INSUFFICIENT_STOCK',
          `Only ${product.stock_pieces} pcs of ${product.name} in stock; ${requiredPieces} pcs are in this sale.`,
          `May ${product.stock_pieces} piraso na lang ng ${product.name}; ${requiredPieces} piraso ang kailangan sa sale na ito.`);
      }
    }

    if (cashReceived < total) {
      throw Object.assign(
        conflict('CASH_SHORT',
          'Cash received is less than the total.',
          'Kulang ang cash na natanggap sa kabuuang halaga.'),
        { details: { total_centavos: total, cash_received_centavos: cashReceived } }
      );
    }
    const change = cashReceived - total;

    let sale = null;
    for (let attempt = 0; attempt < 5 && !sale; attempt += 1) {
      try {
        const { rows: sRows } = await client.query(
          `INSERT INTO walkin_sales
             (sale_code, total_centavos, cash_received_centavos, change_centavos, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *;`,
          [`WALK-${crypto.randomInt(10000, 100000)}`, total, cashReceived, change, actor || '']
        );
        sale = sRows[0];
      } catch (err) {
        if (err.code !== '23505' || attempt === 4) throw err;
      }
    }

    for (const line of lines) {
      await client.query(
        'UPDATE products SET stock_pieces = stock_pieces - $1 WHERE id = $2;',
        [line.pieces, line.product_id]
      );
      await client.query(
        `INSERT INTO stock_movements (product_id, change_pieces, reason, note, created_by)
         VALUES ($1, $2, 'POS_SALE', $3, $4);`,
        [line.product_id, -line.pieces,
          `${sale.sale_code}: ${line.qty} ${line.unit.toLowerCase()}(s)`, actor || '']
      );
      await client.query(
        `INSERT INTO walkin_sale_items
           (sale_id, product_id, product_name, pieces_per_bundle, unit, qty,
            unit_price_centavos, line_total_centavos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
        [sale.id, line.product_id, line.product_name, line.pieces_per_bundle,
          line.unit, line.qty, line.unit_price_centavos, line.line_total_centavos]
      );
    }

    await client.query('COMMIT');
    return {
      sale_code: sale.sale_code,
      lines: lines.map(({ pieces, ...rest }) => rest),
      total_centavos: total,
      cash_received_centavos: cashReceived,
      change_centavos: change,
      created_at: sale.created_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Recent counter sales for the POS history / reports drill-down. */
async function recentSales(limit = 50) {
  const { getClient: _g, query } = require('../config/db');
  const { rows } = await query(
    'SELECT * FROM walkin_sales ORDER BY created_at DESC LIMIT $1;',
    [Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}

module.exports = { createSale, recentSales };
