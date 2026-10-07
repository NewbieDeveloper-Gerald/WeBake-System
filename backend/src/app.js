/**
 * Express application wiring.
 *
 * WHAT: Creates the app, applies global middleware in the correct ORDER,
 * mounts route groups, then attaches the 404 + error handlers LAST.
 *
 * WHY order matters: Express runs middleware top-to-bottom. CORS must run
 * before routes (or browsers block responses), body parsing before validation,
 * and error handlers after everything (or they never see the errors).
 *
 * SECURITY: CORS uses an exact allowlist from env (deployed frontend + one dev
 * origin). No wildcards, so random websites cannot call this API from a browser
 * using the visitor's credentials.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const otpRoutes = require('./routes/otp');
const productsRoutes = require('./routes/products');
const ordersRoutes = require('./routes/orders');
const cartRoutes = require('./routes/cart');
const settingsRoutes = require('./routes/settings');
const adminProductsRoutes = require('./routes/adminProducts');
const adminOrdersRoutes = require('./routes/adminOrders');
const adminRefundsRoutes = require('./routes/adminRefunds');
const adminReportsRoutes = require('./routes/adminReports');
const adminPosRoutes = require('./routes/adminPos');
const adminSettingsRoutes = require('./routes/adminSettings');
const adminVerificationRoutes = require('./routes/adminVerification');

function createApp() {
  const app = express();

  // Render terminates TLS at its proxy and forwards HTTP internally.
  // trust proxy lets rate limiting + logging see the REAL client IP.
  app.set('trust proxy', 1);

  // Hide the Server header fingerprint ("X-Powered-By: Express").
  app.disable('x-powered-by');

  const allowedOrigins = [config.cors.frontendUrl, config.cors.devOrigin]
    .filter((o) => o && o.length > 0);

  app.use(cors({
    origin(origin, callback) {
      // No Origin header = curl, Render health checks, server-to-server: allow.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Parse JSON bodies (10kb cap: login payloads are tiny; huge bodies are abuse).
  // NOTE: proof photos upload as multipart via multer, not JSON - the cap does
  // not apply to them (multer enforces its own 5MB file limit).
  app.use(express.json({ limit: '10kb' }));

  // --- Routes ---
  app.use('/health', healthRoutes); // Render health check path
  app.use('/api/health', healthRoutes); // Backwards-compatible alias
  app.use('/api/auth', authRoutes);
  app.use('/api/otp', otpRoutes);
  app.use('/api/products', productsRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/admin/products', adminProductsRoutes);
  app.use('/api/admin/orders', adminOrdersRoutes);
  app.use('/api/admin/refunds', adminRefundsRoutes);
  app.use('/api/admin/reports', adminReportsRoutes);
  app.use('/api/admin/pos', adminPosRoutes);
  app.use('/api/admin/settings', adminSettingsRoutes);
  app.use('/api/admin/verification', adminVerificationRoutes);

  // --- Final handlers (order is critical: 404 first, then error catcher) ---
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
