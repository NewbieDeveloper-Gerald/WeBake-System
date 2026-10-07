/**
 * Member cart: one JSONB row per member, synced across devices.
 *
 * WHAT: get() reads lines; set() replaces or merges them. Merging sums
 * bundles per product (guest cart + saved cart combine quantities instead of
 * duplicating lines). Lines store NO prices - checkout re-prices everything
 * from the catalog, so stale carts can never lock in old prices.
 */

'use strict';

const { query } = require('../config/db');

async function get(memberId) {
  const { rows } = await query('SELECT items FROM carts WHERE member_id = $1;', [memberId]);
  return (rows[0] && rows[0].items) || [];
}

async function set(memberId, items, merge) {
  let final = items;
  if (merge) {
    const current = await get(memberId);
    const sums = new Map();
    for (const line of [...current, ...items]) {
      const pid = Number(line.product_id);
      const qty = Number(line.bundles);
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(qty) || qty <= 0) continue;
      sums.set(pid, (sums.get(pid) || 0) + qty);
    }
    final = [...sums.entries()].map(([product_id, bundles]) => ({ product_id, bundles }));
  }
  final = final.slice(0, 50);
  await query(
    `INSERT INTO carts (member_id, items, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (member_id) DO UPDATE SET items = EXCLUDED.items, updated_at = NOW();`,
    [memberId, JSON.stringify(final)]
  );
  return final;
}

module.exports = { get, set };
