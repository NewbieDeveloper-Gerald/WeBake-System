/**
 * Reviews routes: returns customer testimonials and handles authenticated review submissions.
 * GET  /api/reviews
 * GET  /api/reviews/eligibility
 * POST /api/reviews
 */

'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const requireMember = require('../middleware/requireMember');
const { validateBody } = require('../validators/common');
const { query } = require('../config/db');
const { verifyToken, bearerFromHeader } = require('../utils/jwt');

const router = express.Router();

const reviewSubmitSchema = z.object({
  order_id: z.coerce.number().int().positive().optional(),
  order_code: z.string().trim().optional(),
  product_id: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  text: z.string().trim().min(5).max(500),
  name: z.string().trim().max(80).optional(),
  location: z.string().trim().max(80).optional(),
});

// GET /api/reviews - public testimonials, latest first
router.get('/', asyncHandler(async (req, res) => {
  const productId = req.query.product_id ? Number(req.query.product_id) : null;
  let sql = `SELECT id, display_name, rating, text_en, created_at, product_id, order_id
               FROM reviews `;
  const params = [];
  if (productId) {
    sql += `WHERE product_id = $1 `;
    params.push(productId);
  }
  sql += `ORDER BY id DESC LIMIT 3;`;
  const { rows } = await query(sql, params);
  return res.json({ success: true, reviews: rows });
}));

// GET /api/reviews/eligibility - check if customer can review a product or completed orders
router.get('/eligibility', asyncHandler(async (req, res) => {
  const payload = verifyToken(bearerFromHeader(req));
  if (!payload || payload.role !== 'member') {
    return res.json({
      success: true,
      eligible: false,
      message: 'You can review this product after your order is completed.',
    });
  }

  const memberId = payload.sub;
  const memberEmail = (payload.email || '').toLowerCase();
  const productId = req.query.product_id ? Number(req.query.product_id) : null;

  let sql = `
    SELECT o.id AS order_id, o.order_code, oi.product_id, oi.product_name, o.created_at
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status = 'COMPLETED'
       AND (o.member_id = $1 OR LOWER(o.customer_email) = $2)
  `;
  const params = [memberId, memberEmail];
  if (productId) {
    sql += ` AND oi.product_id = $3`;
    params.push(productId);
  }
  sql += ` ORDER BY o.id DESC;`;

  const { rows: eligibleItems } = await query(sql, params);

  const { rows: reviewedRows } = await query(
    `SELECT order_id, product_id FROM reviews WHERE member_id = $1 OR order_id IN (
       SELECT id FROM orders WHERE member_id = $1 OR LOWER(customer_email) = $2
     );`,
    [memberId, memberEmail]
  );
  const reviewedSet = new Set(reviewedRows.map((r) => `${r.order_id}_${r.product_id}`));

  const pendingReview = eligibleItems.filter((item) => !reviewedSet.has(`${item.order_id}_${item.product_id}`));

  return res.json({
    success: true,
    eligible: pendingReview.length > 0,
    reviewed_keys: Array.from(reviewedSet),
    available: pendingReview,
    message: pendingReview.length > 0
      ? 'Eligible to review'
      : (eligibleItems.length > 0 ? 'All eligible products have already been reviewed.' : 'You can review this product after your order is completed.'),
  });
}));

// POST /api/reviews - submit review, locked strictly to completed orders
router.post('/', requireMember, validateBody(reviewSubmitSchema), asyncHandler(async (req, res) => {
  const { order_id, order_code, product_id, rating, text, name, location } = req.body;
  if (!order_id && !order_code) {
    return res.status(400).json({
      success: false,
      code: 'BAD_REQUEST',
      message: 'Order ID or Order Code is required.',
    });
  }

  // 1. Look up order
  let orderSql = `SELECT id, order_code, member_id, customer_email, customer_name, status FROM orders WHERE `;
  let orderParams = [];
  if (order_id) {
    orderSql += `id = $1`;
    orderParams = [order_id];
  } else {
    orderSql += `order_code = $1`;
    orderParams = [order_code.toUpperCase()];
  }
  const { rows: orderRows } = await query(orderSql, orderParams);
  if (!orderRows.length) {
    return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Order not found.' });
  }
  const order = orderRows[0];

  // 2. Ownership check
  const memberEmail = req.member.email.toLowerCase();
  const isOwner = (Number(order.member_id) === Number(req.member.id)) ||
                  (String(order.customer_email || '').toLowerCase() === memberEmail);
  if (!isOwner) {
    return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You can only review your own orders.' });
  }

  // 3. Status check: Only COMPLETED orders unlock reviews
  if (order.status !== 'COMPLETED') {
    return res.status(403).json({
      success: false,
      code: 'ORDER_NOT_COMPLETED',
      message: 'You can review this product after your order is completed.',
    });
  }

  // 4. Product check: Must be an item in this order
  const { rows: itemRows } = await query(
    `SELECT id, product_id, product_name FROM order_items WHERE order_id = $1 AND product_id = $2;`,
    [order.id, product_id]
  );
  if (!itemRows.length) {
    return res.status(400).json({
      success: false,
      code: 'PRODUCT_NOT_IN_ORDER',
      message: 'You can only review products that you actually received in this order.',
    });
  }

  // 5. Duplicate check: Prevent duplicate review for same product and order
  const { rows: existingRows } = await query(
    `SELECT id FROM reviews WHERE order_id = $1 AND product_id = $2;`,
    [order.id, product_id]
  );
  if (existingRows.length > 0) {
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_REVIEW',
      message: 'You have already reviewed this product for this order.',
    });
  }

  // 6. Insert review
  const displayName = location
    ? `${name || order.customer_name}, ${location}`
    : (name || order.customer_name || 'Customer');

  const { rows: newRows } = await query(
    `INSERT INTO reviews (order_id, product_id, member_id, display_name, rating, text_en, is_seed)
     VALUES ($1, $2, $3, $4, $5, $6, false)
     RETURNING id, order_id, product_id, display_name, rating, text_en, created_at;`,
    [order.id, product_id, req.member.id, displayName, rating, text]
  );

  return res.status(201).json({
    success: true,
    message: 'Review submitted! Thank you for your feedback.',
    review: newRows[0],
  });
}));

module.exports = router;
