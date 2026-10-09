/**
 * Inventory service: the ONLY code allowed to change stock_pieces.
 *
 * WHAT: adjust() (restock / manual correction), logMovement(), lowStock(),
 * movements(), plus the pure computeStockStatus() rule.
 *
 * WHY funnel everything here: stock is the number most likely to go wrong
 * (oversells, lost returns). One writer + one audit table means any count can
 * be reconciled: current stock should equal SUM(movements) from zero.
 *
 * CONCURRENCY: adjust() locks the product row (SELECT ... FOR UPDATE) inside
 * a transaction, so two simultaneous sales cannot both read "100" and both
 * write "75". The loser waits, then re-reads the fresh value.
 */

'use strict';

const { query, getClient } = require('../config/db');
const { notFound, conflict } = require('../utils/serviceError');

const STATUS = Object.freeze({
  IN_STOCK: 'IN_STOCK',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
});

/**
 * PURE rule (no database): derive display status from counts.
 * Boundary: stock <= threshold (and > 0) is LOW; exactly 0 is OUT.
 */
function computeStockStatus(stockPieces, thresholdPieces) {
  if (stockPieces <= 0) return STATUS.OUT_OF_STOCK;
  if (stockPieces <= thresholdPieces) return STATUS.LOW_STOCK;
  return STATUS.IN_STOCK;
}

/** Whole bundles on the shelf: floor(pieces / 25). POS uses the remainder. */
function bundlesAvailable(stockPieces, piecesPerBundle) {
  return Math.floor(stockPieces / piecesPerBundle);
}

function toCard(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    price_bundle_centavos: row.price_bundle_centavos,
    pieces_per_bundle: row.pieces_per_bundle,
    piece_price_centavos: row.piece_price_centavos,
    stock_pieces: row.stock_pieces,
    low_stock_threshold_pieces: row.low_stock_threshold_pieces,
    image_url: row.image_url,
    is_archived: row.is_archived,
    stock_status: computeStockStatus(row.stock_pieces, row.low_stock_threshold_pieces),
    bundles_available: bundlesAvailable(row.stock_pieces, row.pieces_per_bundle),
  };
}

/**
 * Adjust stock by delta OR set an absolute count (service accepts both; the
 * validator guarantees exactly one). Writes the movement row in the SAME
 * transaction - stock and audit trail can never disagree.
 */
async function adjust(productId, { setPieces, changePieces }, reason, note, actor) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM products WHERE id = $1 FOR UPDATE;',
      [productId]
    );
    if (rows.length === 0) {
      throw notFound('Product not found.');
    }
    const product = rows[0];

    const delta = setPieces !== undefined
      ? setPieces - product.stock_pieces
      : changePieces;
    if (delta === 0) {
      throw conflict(
        'NO_CHANGE',
        'The new stock equals the current stock. Nothing to save.'
      );
    }
    const next = product.stock_pieces + delta;
    if (next < 0) {
      throw conflict(
        'INSUFFICIENT_STOCK',
        `Cannot remove ${Math.abs(delta)} pieces. Only ${product.stock_pieces} in stock.`
      );
    }

    await client.query(
      'UPDATE products SET stock_pieces = $1 WHERE id = $2;',
      [next, productId]
    );
    await client.query(
      `INSERT INTO stock_movements
         (product_id, change_pieces, reason, note, created_by)
       VALUES ($1, $2, $3, $4, $5);`,
      [productId, delta, reason, note || '', actor || '']
    );

    await client.query('COMMIT');
    const { rows: fresh } = await query('SELECT * FROM products WHERE id = $1;', [productId]);
    return toCard(fresh[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Append-only movement history, newest first. Optional product filter. */
async function movements({ productId, limit = 100 } = {}) {
  const capped = Math.min(Math.max(limit, 1), 500);
  if (productId) {
    const { rows } = await query(
      `SELECT m.*, p.name AS product_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
        WHERE m.product_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2;`,
      [productId, capped]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT m.*, p.name AS product_name
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       ORDER BY m.created_at DESC
       LIMIT $1;`,
    [capped]
  );
  return rows;
}

/** Everything needing attention: out-of-stock first, then low stock. */
async function lowStock() {
  const { rows } = await query(
    `SELECT * FROM products
      WHERE is_archived = FALSE AND stock_pieces <= low_stock_threshold_pieces
      ORDER BY stock_pieces ASC;`
  );
  return rows.map(toCard);
}

module.exports = {
  STATUS,
  computeStockStatus,
  bundlesAvailable,
  toCard,
  adjust,
  movements,
  lowStock,
};
