/**
 * Public reviews route: returns customer testimonials from the database and accepts new reviews.
 * GET  /api/reviews
 * POST /api/reviews
 */

'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const { validateBody } = require('../validators/common');
const { query } = require('../config/db');

const router = express.Router();

const reviewSchema = z.object({
  name: z.string().trim().min(2).max(80),
  location: z.string().trim().max(80).default('Bulacan'),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  text: z.string().trim().min(5).max(500),
}).strict();

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, display_name, rating, text_en, text_fil, created_at
       FROM reviews
      ORDER BY id DESC
      LIMIT 3;`
  );
  return res.json({ success: true, reviews: rows });
}));

router.post('/', validateBody(reviewSchema), asyncHandler(async (req, res) => {
  const { name, location, rating, text } = req.body;
  const displayName = location ? `${name}, ${location}` : name;
  const { rows } = await query(
    `INSERT INTO reviews (display_name, rating, text_en, text_fil, is_seed)
     VALUES ($1, $2, $3, $3, false)
     RETURNING id, display_name, rating, text_en, text_fil, created_at;`,
    [displayName, rating, text]
  );
  return res.status(201).json({
    success: true,
    message: 'Review submitted! Thank you for your feedback.',
    review: rows[0],
  });
}));

module.exports = router;

