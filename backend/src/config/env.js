/**
 * Central environment loader.
 *
 * WHAT: Reads process.env once, validates the REQUIRED variables, and exports
 * a frozen config object with safe defaults for everything else.
 *
 * WHY: Scattered `process.env.X || 'fallback'` calls across files hide missing
 * config until a request fails at 2am. Failing fast at boot with a clear message
 * ("JWT_SECRET is missing") is cheaper than debugging production.
 *
 * Phase note: Brevo and Supabase Storage keys are optional until Phase 4.
 * The server boots without them but mailer/storage features stay disabled.
 */

'use strict';

const path = require('path');

// Load backend/.env in local dev. On Render, real env vars are injected by the
// platform, so config() is a harmless no-op when no .env file exists.
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function required(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    // Throwing here crashes the boot on purpose: fail fast, fail loud.
    throw new Error(`Missing REQUIRED environment variable: ${name}. See backend/.env.example.`);
  }
  return value;
}

function optional(name, fallback) {
  const value = (process.env[name] || '').trim();
  return value === '' ? fallback : value;
}

function toInt(name, fallback) {
  const raw = optional(name, String(fallback));
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: "${raw}".`);
  }
  return parsed;
}

// --- Validate security-critical values before anything else runs ---
const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long. Generate one, see .env.example.');
}

// DATABASE_URL or the DB_* parts must exist; db.js decides which to use.
const hasDatabaseUrl = (process.env.DATABASE_URL || '').trim() !== '';
const hasDbParts = (process.env.DB_HOST || '').trim() !== '';
if (!hasDatabaseUrl && !hasDbParts) {
  throw new Error('Set DATABASE_URL (recommended) or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.');
}

const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: toInt('PORT', 5000),

  db: {
    // Prefer the pooler URL when present; otherwise fall back to parts.
    connectionString: hasDatabaseUrl ? process.env.DATABASE_URL.trim() : null,
    host: optional('DB_HOST', ''),
    port: toInt('DB_PORT', 6543),
    user: optional('DB_USER', ''),
    password: optional('DB_PASSWORD', ''),
    database: optional('DB_NAME', 'postgres'),
  },

  auth: {
    jwtSecret,
    bcryptRounds: toInt('BCRYPT_ROUNDS', 12),
    memberExpiresIn: optional('MEMBER_JWT_EXPIRES_IN', '7d'),
    adminExpiresIn: optional('ADMIN_JWT_EXPIRES_IN', '12h'),
  },

  cors: {
    // Exact allowlist: deployed frontend + one dev origin. Nothing else.
    frontendUrl: optional('FRONTEND_URL', ''),
    devOrigin: optional('DEV_ORIGIN', ''),
  },

  seed: {
    adminEmail: optional('ADMIN_EMAIL', 'crbwebake@gmail.com').toLowerCase(),
    adminPassword: optional('ADMIN_PASSWORD', ''),
  },

  // Phase 4 placeholders. Empty string = feature disabled, server still boots.
  brevo: {
    apiKey: optional('BREVO_API_KEY', ''),
    senderEmail: optional('BREVO_SENDER_EMAIL', 'crbwebake@gmail.com'),
    senderName: optional('BREVO_SENDER_NAME', "WeBake - Crumbs N' Rolls Bakery"),
  },
  storage: {
    url: optional('SUPABASE_URL', ''),
    serviceRoleKey: optional('SUPABASE_SERVICE_ROLE_KEY', ''),
  },

  business: {
    defaultLowStockPieces: toInt('DEFAULT_LOW_STOCK_PIECES', 500), // 20 bundles x 25
    minOrderBundles: toInt('MIN_ORDER_BUNDLES', 300),
  },

  otp: {
    codeMinutes: toInt('OTP_CODE_MINUTES', 5),
    cooldownSeconds: toInt('OTP_COOLDOWN_SECONDS', 60),
    maxAttempts: toInt('OTP_MAX_ATTEMPTS', 5),
    // How long a verified code stays usable for its action (register, etc).
    verifiedTtlMinutes: toInt('OTP_VERIFIED_TTL_MINUTES', 30),
  },

  reset: {
    tokenMinutes: toInt('RESET_TOKEN_MINUTES', 30),
  },
};

// Freeze so no module can mutate config at runtime by accident.
module.exports = Object.freeze(config);
