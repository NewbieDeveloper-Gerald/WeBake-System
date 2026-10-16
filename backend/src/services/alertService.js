/**
 * Alert service: Single source of truth for bakery stock alerts.
 *
 * Computes out-of-stock and low-stock alerts for both Products and Ingredients
 * using the EXACT same business logic across Dashboard and Inventory pages:
 * - OUT_OF_STOCK: stock <= 0
 * - LOW_STOCK: stock > 0 AND stock <= threshold / reorder_level
 * Excludes archived or inactive products.
 * Sorts: Out-of-stock first, then lowest stock ratio (quantity / reorder_level) ascending.
 */

'use strict';

const { query: defaultQuery } = require('../config/db');

async function getStockAlerts(customClient) {
  const runner = customClient && typeof customClient.query === 'function'
    ? (sql, params) => customClient.query(sql, params)
    : (sql, params) => defaultQuery(sql, params);

  // 1. Products Alerts
  const productsRes = await runner(`
    SELECT id, name, stock_pieces, low_stock_threshold_pieces, pieces_per_bundle,
           image_url, is_archived
      FROM products
     WHERE is_archived = false
       AND stock_pieces <= low_stock_threshold_pieces
     ORDER BY (stock_pieces <= 0) DESC,
              (stock_pieces::float / GREATEST(1, low_stock_threshold_pieces)) ASC;
  `);

  const products = productsRes.rows.map((p) => {
    const qty = Number(p.stock_pieces) || 0;
    const threshold = Number(p.low_stock_threshold_pieces) || 0;
    const isOut = qty <= 0;
    const ratio = threshold > 0 ? (qty / threshold) : 0;
    const ppb = Number(p.pieces_per_bundle) || 1;
    const bundles = Math.floor(qty / ppb);

    return {
      id: p.id,
      name: p.name,
      quantity: qty,
      reorder_level: threshold,
      unit: 'pcs',
      bundles_available: bundles,
      severity: isOut ? 'out_of_stock' : 'low_stock',
      severity_label: isOut ? 'Out of Stock' : 'Low Stock',
      ratio,
      image_url: p.image_url || null,
      type: 'product',
    };
  });

  // 2. Ingredients Alerts
  let ingredients = [];
  try {
    const ingRes = await runner(`
      SELECT id, name, stock_quantity, unit, reorder_level, cost_per_unit, expiry_date, stock_status
        FROM public.ingredient_stock_status
       WHERE stock_status IN ('out_of_stock', 'low_stock')
       ORDER BY (stock_status = 'out_of_stock' OR stock_quantity <= 0) DESC,
                (stock_quantity::float / GREATEST(0.001, reorder_level)) ASC;
    `);

    ingredients = ingRes.rows.map((ing) => {
      const qty = Number(ing.stock_quantity) || 0;
      const reorder = Number(ing.reorder_level) || 0;
      const isOut = ing.stock_status === 'out_of_stock' || qty <= 0;
      const ratio = reorder > 0 ? (qty / reorder) : 0;

      return {
        id: ing.id,
        name: ing.name,
        quantity: qty,
        reorder_level: reorder,
        unit: ing.unit || 'kg',
        severity: isOut ? 'out_of_stock' : 'low_stock',
        severity_label: isOut ? 'Out of Stock' : 'Low Stock',
        ratio,
        cost_per_unit: ing.cost_per_unit != null ? Number(ing.cost_per_unit) : null,
        expiry_date: ing.expiry_date || null,
        type: 'ingredient',
      };
    });
  } catch (err) {
    console.warn('[alertService] ingredient_stock_status query warning:', err.message);
  }

  // 3. Summaries & Most Severe Tab Detection
  const productsOut = products.filter((p) => p.severity === 'out_of_stock').length;
  const productsLow = products.filter((p) => p.severity === 'low_stock').length;
  const ingredientsOut = ingredients.filter((i) => i.severity === 'out_of_stock').length;
  const ingredientsLow = ingredients.filter((i) => i.severity === 'low_stock').length;

  // Decide default tab: out of stock takes precedence, then low stock count
  let mostSevere = 'products';
  if (ingredientsOut > productsOut) {
    mostSevere = 'ingredients';
  } else if (ingredientsOut === productsOut) {
    if (ingredientsLow > productsLow) {
      mostSevere = 'ingredients';
    }
  }

  const summary = {
    products_out: productsOut,
    products_low: productsLow,
    products_total: products.length,
    ingredients_out: ingredientsOut,
    ingredients_low: ingredientsLow,
    ingredients_total: ingredients.length,
    total_out: productsOut + ingredientsOut,
    total_low: productsLow + ingredientsLow,
    total_alerts: products.length + ingredients.length,
    most_severe: mostSevere,
  };

  return {
    products,
    ingredients,
    summary,
  };
}

module.exports = {
  getStockAlerts,
};

