/**
 * Settings service: bakery configuration key/value store.
 *
 * WHAT: getAll (admin), update (admin upsert), getNumber (typed read with
 * fallback), getPublic (checkout-safe subset: wallet numbers, QR paths,
 * store hours, minimum order).
 *
 * WHY settings beat env for business rules: the owner edits these in the
 * admin panel without a redeploy. Env keeps only boot-time secrets and
 * infrastructure. Order creation reads min_order_bundles from HERE (with the
 * env value as fallback when the key is missing).
 */

'use strict';

const { query } = require('../config/db');
const orderQuantityOptions = require('../config/orderQuantityOptions');

async function getAll() {
  const { rows } = await query('SELECT key, value FROM settings;');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function update(map) {
  const entries = Object.entries(map);
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
      [key, String(value)]
    );
  }
  return getAll();
}

/** Typed numeric read with fallback (never throws on missing/garbage). */
async function getNumber(key, fallback) {
  const { rows } = await query('SELECT value FROM settings WHERE key = $1;', [key]);
  if (rows.length === 0) return fallback;
  const parsed = parseInt(rows[0].value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Public subset for the checkout page. No secrets live in settings. */
async function getPublic() {
  const all = await getAll();
  return {
    gcash_number: all.gcash_number || '',
    paymaya_number: all.paymaya_number || '',
    account_name: all.account_name || '',
    gcash_qr: all.gcash_qr || '',
    paymaya_qr: all.paymaya_qr || '',
    min_order_bundles: all.min_order_bundles || '300',
    order_quantity_options: orderQuantityOptions,
  };
}

module.exports = { getAll, update, getNumber, getPublic };
