/**
 * Health check endpoint.
 *
 * WHAT: GET /health (and /api/health) reports whether the API and database
 * are reachable. Render pings this path after every deploy to decide if the
 * new version is alive.
 *
 * WHY 200-vs-503 matters: returning 200 with connected:false would tell Render
 * "all good" while the database is down. Degraded DB -> 503 so deploys and
 * monitors react honestly. The endpoint itself NEVER throws.
 */

'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { ping } = require('../config/db');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const dbStatus = await ping();
    const healthy = dbStatus.connected;
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      service: 'webake-backend',
      database: dbStatus,
      timestamp: new Date().toISOString(),
    });
  })
);

module.exports = router;
