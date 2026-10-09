/**
 * Member cart service: backed by public.cart_items and synced with carts table.
 *
 * WHAT: get() reads lines from cart_items; set() replaces or merges them.
 * Merging sums bundles per product. Lines store NO prices - checkout re-prices
 * everything from the catalog, so stale carts can never lock in old prices.
 */

'use strict';

const { query } = require('../config/db');
const ORDER_QUANTITIES = require('../config/orderQuantityOptions');

async function get(memberId) {
  const { rows } = await query(
    `SELECT ci.product_id, ci.bundles
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
      WHERE ci.member_id = $1 AND p.is_archived = false
      ORDER BY ci.product_id ASC;`,
    [memberId]
  );
  if (rows.length > 0) {
    return rows.map((r) => ({ product_id: Number(r.product_id), bundles: Number(r.bundles) }));
  }

  // Fallback: if cart_items has no rows, check carts.items JSONB column
  const { rows: cartRows } = await query('SELECT items FROM carts WHERE member_id = $1;', [memberId]);
  const legacyItems = (cartRows[0] && cartRows[0].items) || [];
  return Array.isArray(legacyItems)
    ? legacyItems.map((r) => ({ product_id: Number(r.product_id), bundles: Number(r.bundles) }))
    : [];
}

async function set(memberId, items, merge) {
  let final = items;
  if (merge) {
    const current = await get(memberId);
    const merged = [];
    for (const line of [...current, ...items]) {
      const pid = Number(line.product_id);
      const qty = Number(line.bundles);
      if (!Number.isInteger(pid) || pid <= 0 || !ORDER_QUANTITIES.includes(qty)) continue;
      const existing = merged.find((entry) => entry.product_id === pid);
      if (existing && ORDER_QUANTITIES.includes(existing.bundles + qty)) existing.bundles += qty;
      else merged.push({ product_id: pid, bundles: qty });
    }
    final = merged;
  }
  final = final.slice(0, 50);

  // 1. Ensure member has a row in public.carts (required by cart_items foreign key)
  await query(
    `INSERT INTO carts (member_id, items, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (member_id) DO UPDATE SET items = EXCLUDED.items, updated_at = NOW();`,
    [memberId, JSON.stringify(final)]
  );

  // 2. Populate public.cart_items table
  await query('DELETE FROM cart_items WHERE member_id = $1;', [memberId]);
  for (const line of final) {
    const pid = Number(line.product_id);
    const qty = Number(line.bundles);
    if (!Number.isInteger(pid) || pid <= 0 || qty <= 0) continue;
    await query(
      `INSERT INTO cart_items (member_id, product_id, bundles)
       VALUES ($1, $2, $3)
       ON CONFLICT (member_id, product_id)
       DO UPDATE SET bundles = EXCLUDED.bundles;`,
      [memberId, pid, qty]
    );
  }

  return final;
}

async function clear(memberId) {
  await query('DELETE FROM cart_items WHERE member_id = $1;', [memberId]);
  await query("UPDATE carts SET items = '[]'::jsonb, updated_at = NOW() WHERE member_id = $1;", [memberId]);
}

module.exports = { get, set, clear };
