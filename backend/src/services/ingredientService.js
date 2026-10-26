/**
 * Ingredient Service: manages raw bakery ingredients & stock movements.
 *
 * Safe: Stock adjustments are funneled exclusively through the PostgreSQL
 * RPC function `adjust_stock` with row-level locks and transactional audit logging.
 */

'use strict';

const { query } = require('../config/db');
const { notFound, fail } = require('../utils/serviceError');

async function list() {
  try {
    const [ingredientsRes, summaryRes] = await Promise.all([
      query(`
        SELECT
          id, name, stock_quantity, unit, reorder_level, cost_per_unit,
          expiry_date::text AS expiry_date, stock_updated_at,
          created_at, updated_at, stock_status, is_archived,
          CASE
            WHEN expiry_date IS NOT NULL
              AND expiry_date <= (CURRENT_DATE + INTERVAL '7 days')
              AND expiry_date >= CURRENT_DATE
            THEN true ELSE false
          END AS is_expiring_soon
        FROM public.ingredient_stock_status
        ORDER BY name ASC;
      `),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE is_archived = false)::int AS total,
          COUNT(*) FILTER (WHERE is_archived = false AND stock_status = 'low_stock')::int AS low_stock,
          COUNT(*) FILTER (WHERE is_archived = false AND stock_status = 'out_of_stock')::int AS out_of_stock,
          COUNT(*) FILTER (
            WHERE is_archived = false
              AND expiry_date IS NOT NULL
              AND expiry_date <= (CURRENT_DATE + INTERVAL '7 days')
              AND expiry_date >= CURRENT_DATE
          )::int AS expiring_soon,
          COUNT(*) FILTER (WHERE is_archived = true)::int AS archived
        FROM public.ingredient_stock_status;
      `),
    ]);

    return {
      ingredients: ingredientsRes.rows,
      summary: summaryRes.rows[0] || { total: 0, low_stock: 0, out_of_stock: 0, expiring_soon: 0 },
    };
  } catch (err) {
    if (err.code === '42P01') {
      console.warn('[ingredients] ingredient_stock_status relation missing (migration pending)');
      return {
        ingredients: [],
        summary: { total: 0, low_stock: 0, out_of_stock: 0, expiring_soon: 0 },
      };
    }
    throw err;
  }
}

async function getById(id) {
  const res = await query(`
    SELECT
      id, name, stock_quantity, unit, reorder_level, cost_per_unit,
      expiry_date::text AS expiry_date, stock_updated_at,
      created_at, updated_at, stock_status,
      CASE
        WHEN expiry_date IS NOT NULL
          AND expiry_date <= (CURRENT_DATE + INTERVAL '7 days')
          AND expiry_date >= CURRENT_DATE
        THEN true ELSE false
      END AS is_expiring_soon
    FROM public.ingredient_stock_status
    WHERE id = $1;
  `, [id]);
  if (res.rows.length === 0) throw notFound('Ingredient not found.');
  return res.rows[0];
}

async function create(data, actor = 'admin') {
  const name = String(data.name || '').trim();
  if (!name) throw fail(400, 'VALIDATION_ERROR', 'Ingredient name is required.');

  const unit = String(data.unit || 'pcs').trim();
  const reorderLevel = Math.max(0, Number(data.reorder_level) || 0);
  const costPerUnit = data.cost_per_unit != null && data.cost_per_unit !== '' ? Number(data.cost_per_unit) : null;
  const expiryDate = data.expiry_date || null;
  const initialStock = Math.max(0, Number(data.stock_quantity) || 0);

  const insertRes = await query(
    `INSERT INTO public.ingredients
      (name, stock_quantity, unit, reorder_level, cost_per_unit, expiry_date, stock_updated_at)
     VALUES ($1, 0, $2, $3, $4, $5, NOW())
     RETURNING *;`,
    [name, unit, reorderLevel, costPerUnit, expiryDate]
  );
  const ingredient = insertRes.rows[0];

  // If initial stock was provided, adjust via the RPC to record opening balance
  if (initialStock > 0) {
    await query(
      `SELECT * FROM public.adjust_stock($1, 'restock', $2, 'Initial opening stock', $3, $4);`,
      [ingredient.id, initialStock, costPerUnit, actor]
    );
  }

  return getById(ingredient.id);
}

async function update(id, data) {
  const existing = await getById(id);
  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name) throw fail(400, 'VALIDATION_ERROR', 'Ingredient name cannot be empty.');

  const unit = data.unit !== undefined ? String(data.unit).trim() : existing.unit;
  const reorderLevel = data.reorder_level !== undefined ? Math.max(0, Number(data.reorder_level) || 0) : existing.reorder_level;
  const costPerUnit = data.cost_per_unit !== undefined
    ? (data.cost_per_unit != null && data.cost_per_unit !== '' ? Number(data.cost_per_unit) : null)
    : existing.cost_per_unit;
  const expiryDate = data.expiry_date !== undefined ? (data.expiry_date || null) : existing.expiry_date;

  // Never update stock_quantity directly here
  await query(
    `UPDATE public.ingredients
     SET name = $1, unit = $2, reorder_level = $3, cost_per_unit = $4, expiry_date = $5
     WHERE id = $6;`,
    [name, unit, reorderLevel, costPerUnit, expiryDate, id]
  );

  return getById(id);
}

async function setArchived(id, isArchived = true) {
  await getById(id);
  const res = await query(
    `UPDATE public.ingredients
     SET is_archived = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *;`,
    [Boolean(isArchived), id]
  );
  return res.rows[0];
}

async function remove(id) {
  // Soft delete: archives ingredient to preserve inventory movement audit trail
  await setArchived(id, true);
  return { success: true, message: 'Ingredient archived.' };
}

async function adjustStock(id, { type, quantity, reason, unitCost }, actor = 'admin') {
  const parsedQty = Number(quantity);
  if (!parsedQty || parsedQty <= 0 || isNaN(parsedQty)) {
    throw fail(400, 'VALIDATION_ERROR', 'Quantity must be a positive number.');
  }

  const validTypes = ['restock', 'usage', 'adjustment', 'waste'];
  if (!validTypes.includes(type)) {
    throw fail(400, 'VALIDATION_ERROR', `Type must be one of: ${validTypes.join(', ')}.`);
  }

  if (type !== 'restock' && (!reason || !reason.trim())) {
    throw fail(400, 'VALIDATION_ERROR', 'A reason is required for usage, waste, or adjustments.');
  }

  try {
    const res = await query(
      `SELECT * FROM public.adjust_stock($1, $2, $3, $4, $5, $6);`,
      [
        id,
        type,
        parsedQty,
        reason ? reason.trim() : null,
        unitCost != null && unitCost !== '' ? Number(unitCost) : null,
        actor,
      ]
    );
    const movement = res.rows[0];
    const ingredient = await getById(id);
    return { movement, ingredient };
  } catch (err) {
    if (err.message && err.message.includes('Insufficient stock')) {
      throw fail(409, 'INSUFFICIENT_STOCK', err.message);
    }
    if (err.message && err.message.includes('Ingredient not found')) {
      throw notFound('Ingredient not found.');
    }
    throw err;
  }
}

async function movements(ingredientId, { limit = 20, offset = 0 } = {}) {
  await getById(ingredientId);
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const parsedOffset = Math.max(0, Number(offset) || 0);

  const [dataRes, countRes] = await Promise.all([
    query(
      `SELECT * FROM public.inventory_movements
       WHERE ingredient_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3;`,
      [ingredientId, parsedLimit, parsedOffset]
    ),
    query(
      `SELECT COUNT(*)::int AS total FROM public.inventory_movements WHERE ingredient_id = $1;`,
      [ingredientId]
    ),
  ]);

  return {
    movements: dataRes.rows,
    total: countRes.rows[0].total,
    limit: parsedLimit,
    offset: parsedOffset,
  };
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  setArchived,
  adjustStock,
  movements,
};
