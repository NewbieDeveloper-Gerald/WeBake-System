-- =====================================================================
-- WeBake migration 001: core tables (admins, members, carts, products,
-- reviews, settings).
--
-- RULES this schema follows:
-- 1. Money is INTEGER centavos (10500 = PHP 105.00). Never NUMERIC/float,
--    because binary floating point cannot represent 0.1 exactly and money
--    must never drift by a centavo.
-- 2. Stock is stored in PIECES. Bundles are display math (pieces / 25), so POS
--    piece sales and bundle sales share one truthful counter.
-- 3. Emails are stored lowercase (the API lowercases before insert) and UNIQUE,
--    so "User@Mail.com" can never create a second account.
-- 4. Phase 3 adds orders, payments, refunds, stock movements, status history.
-- =====================================================================

-- Keeps updated_at fresh on every UPDATE without application code.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- admins: the single owner account. No staff roles by design (spec).
-- reset_* columns support the Phase 4 email reset link (token HASH stored,
-- plain token only ever travels inside the email URL, 30-min expiry).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id                BIGSERIAL PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  reset_token_hash  TEXT NULL,
  reset_expires_at  TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- members: customer accounts. member_id on orders is NULLABLE because guests
-- can order without an account; when a guest later registers with the same
-- verified email, past orders link to the new member id (Phase 4).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id                BIGSERIAL PRIMARY KEY,
  full_name         TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  email_verified_at TIMESTAMPTZ NULL,
  contact           TEXT NOT NULL,
  address           TEXT NOT NULL DEFAULT '',
  password_hash     TEXT NOT NULL,
  locale            TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fil')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- carts: one row per member, cross-device cart (spec Q9). Items shape:
-- [{"product_id": 1, "bundles": 300}]. Guest carts stay in browser
-- localStorage and merge into this table at login (Phase 6).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carts (
  member_id   BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- products: the 8 wholesale products. Archive (is_archived) hides a product
-- from the shop while preserving all order history - there is intentionally
-- NO hard DELETE path in the API.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                          BIGSERIAL PRIMARY KEY,
  name                        TEXT NOT NULL UNIQUE,
  slug                        TEXT NOT NULL UNIQUE,
  description                 TEXT NOT NULL DEFAULT '',
  price_bundle_centavos       INTEGER NOT NULL DEFAULT 10500 CHECK (price_bundle_centavos > 0),
  pieces_per_bundle           INTEGER NOT NULL DEFAULT 25 CHECK (pieces_per_bundle > 0),
  piece_price_centavos        INTEGER NOT NULL DEFAULT 500 CHECK (piece_price_centavos > 0),
  stock_pieces                INTEGER NOT NULL DEFAULT 0 CHECK (stock_pieces >= 0),
  low_stock_threshold_pieces  INTEGER NOT NULL DEFAULT 500 CHECK (low_stock_threshold_pieces >= 0),
  image_url                   TEXT NOT NULL DEFAULT '',
  is_archived                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- reviews: seeded SAMPLE reviews for display only (spec). is_seed marks rows
-- the seed script owns; when real reviews ship later, they insert with
-- is_seed = false and the same display code renders both.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id            BIGSERIAL PRIMARY KEY,
  display_name  TEXT NOT NULL,
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text_en       TEXT NOT NULL,
  text_fil      TEXT NOT NULL DEFAULT '',
  is_seed       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- settings: single key/value store for payment details and business rules.
-- Admin-editable in Phase 5; the seed only inserts keys that are missing so
-- re-running seed NEVER overwrites owner changes.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-touch triggers (dropped first so re-running the file stays safe).
DROP TRIGGER IF EXISTS trg_admins_updated ON admins;
CREATE TRIGGER trg_admins_updated BEFORE UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_members_updated ON members;
CREATE TRIGGER trg_members_updated BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_carts_updated ON carts;
CREATE TRIGGER trg_carts_updated BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated ON settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
