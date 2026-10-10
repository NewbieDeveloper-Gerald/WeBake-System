/**
 * Public reviews route: returns customer testimonials from the database.
 * GET /api/reviews
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { query } = require('../config/db');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, display_name, rating, text_en, text_fil, created_at
       FROM reviews
      ORDER BY id ASC;`
  );
  return res.json({ success: true, reviews: rows });
}));

module.exports = router;

