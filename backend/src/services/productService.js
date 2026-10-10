/**
 * Product catalog service: reads for the shop, writes for the admin.
 *
 * WHAT: listPublic (shop + POS), listAdmin (all incl. archived), create,
 * update, setArchived. Stock itself is adjusted only via inventoryService.
 *
 * WHY archiving instead of delete: orders snapshot product names, but reports
 * join products for history. Hard-deleting would orphan history; archiving
 * hides the product everywhere customer-facing while preserving every record.
 */

'use strict';

const { query, getClient } = require('../config/db');
const { notFound, conflict } = require('../utils/serviceError');
const inventory = require('./inventoryService');

/** Customer shop + POS: visible products only, with live stock status. */
async function listPublic() {
  const { rows } = await query(
    'SELECT * FROM products WHERE is_archived = FALSE ORDER BY id ASC;'
  );
  return rows.map(inventory.toCard);
}

/** Admin catalog: everything, archived included. */
async function listAdmin() {
  const { rows } = await query('SELECT * FROM products ORDER BY id ASC;');
  return rows.map(inventory.toCard);
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM products WHERE id = $1;', [id]);
  if (rows.length === 0) {
    throw notFound('Product not found.');
  }
  return inventory.toCard(rows[0]);
}

async function create(data, actor) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    let product;
    try {
      const { rows } = await client.query(
        `INSERT INTO products
           (name, description, price_bundle_centavos, pieces_per_bundle,
            piece_price_centavos, stock_pieces, low_stock_threshold_pieces, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *;`,
        [
          data.name.trim(), data.description,
          data.price_bundle_centavos, data.pieces_per_bundle,
          data.piece_price_centavos, data.initial_stock_pieces,
          data.low_stock_threshold_pieces, data.image_url,
        ]
      );
      product = rows[0];
    } catch (err) {
      // 23505 = unique violation (duplicate name). Translate to 409.
      if (err.code === '23505') {
        throw conflict(
          'DUPLICATE_PRODUCT',
          'A product with this name already exists.'
        );
      }
      throw err;
    }

    // Opening stock enters through the same audit trail as every other move.
    if (data.initial_stock_pieces > 0) {
      await client.query(
        `INSERT INTO stock_movements
           (product_id, change_pieces, reason, note, created_by)
         VALUES ($1, $2, 'RESTOCK', 'Opening stock', $3);`,
        [product.id, data.initial_stock_pieces, actor || '']
      );
    }
    await client.query('COMMIT');
    return inventory.toCard(product);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(id, data) {
  // Build a dynamic SET clause from only the provided keys (all pre-validated
  // by zod, so no injection risk - values still go through placeholders).
  const fields = [];
  const values = [];
  const map = {
    name: 'name',
    description: 'description',
    price_bundle_centavos: 'price_bundle_centavos',
    pieces_per_bundle: 'pieces_per_bundle',
    piece_price_centavos: 'piece_price_centavos',
    low_stock_threshold_pieces: 'low_stock_threshold_pieces',
    image_url: 'image_url',
  };
  for (const [key, column] of Object.entries(map)) {
    if (data[key] !== undefined) {
      values.push(key === 'name' ? data[key].trim() : data[key]);
      fields.push(`${column} = $${values.length}`);
    }
  }
  if (fields.length === 0) return getById(id); // nothing to change

  values.push(id);
  try {
    const { rows } = await query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *;`,
      values
    );
    if (rows.length === 0) {
      throw notFound('Product not found.');
    }
    return inventory.toCard(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw conflict(
        'DUPLICATE_PRODUCT',
        'A product with this name already exists.'
      );
    }
    throw err;
  }
}

/** Archive hides from shop/POS; restore brings back. History untouched. */
async function setArchived(id, archived) {
  const { rows } = await query(
    'UPDATE products SET is_archived = $1 WHERE id = $2 RETURNING *;',
    [archived, id]
  );
  if (rows.length === 0) {
    throw notFound('Product not found.');
  }
  return inventory.toCard(rows[0]);
}

module.exports = { listPublic, listAdmin, getById, create, update, setArchived };
