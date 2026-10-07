-- =====================================================================
-- WeBake migration 000: stash legacy tables out of the way (runs FIRST).
--
-- PROBLEM: the old schema used the SAME table names (products, orders,
-- order_items, payments, order_status_history) with DIFFERENT columns. If
-- this runs against a database that already has the legacy schema, migration
-- 001/002's CREATE TABLE IF NOT EXISTS would silently KEEP the old tables
-- and every later statement would fail on missing columns.
--
-- FIX: rename legacy tables to legacy_* BEFORE 001/002 create the new ones.
-- Each rename is guarded by a legacy SIGNATURE COLUMN (not just the table
-- name), so new-shape tables are never touched and fresh databases are a
-- harmless no-op. Migration 003 then imports from the legacy_* copies.
-- =====================================================================

CREATE OR REPLACE FUNCTION legacy_has_column(t TEXT, c TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = c
  );
$$ LANGUAGE sql;

DO $$
DECLARE
  -- name, signature column proving LEGACY shape (NULL = name alone is proof
  -- because the new schema has no table by that name).
  targets TEXT[][] := ARRAY[
    ['users', 'email_address'],
    ['user_addresses', 'address_line1'],
    ['roles', NULL],
    ['product_categories', NULL],
    ['products', 'product_name'],
    ['product_bundles', NULL],
    ['orders', 'grand_total'],
    ['order_items', 'quantity'],
    ['payments', 'payment_channel'],
    ['order_status_history', 'previous_status'],
    ['cancellation_requests', NULL],
    ['refund_transactions', NULL],
    ['store_settings', NULL],
    ['otp_verifications', NULL]
  ];
  pair TEXT[];
  old_name TEXT;
  sig_col TEXT;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY targets LOOP
    old_name := pair[1];
    sig_col := pair[2];

    -- Skip when: no such table, already stashed, or (for colliding names)
    -- the table already has the NEW shape.
    IF to_regclass('public.' || old_name) IS NULL THEN CONTINUE; END IF;
    IF to_regclass('public.legacy_' || old_name) IS NOT NULL THEN
      RAISE NOTICE '000: legacy_% already exists, skipping.', old_name;
      CONTINUE;
    END IF;
    IF sig_col IS NOT NULL AND NOT legacy_has_column(old_name, sig_col) THEN
      RAISE NOTICE '000: % has new shape, leaving in place.', old_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I RENAME TO %I;', old_name, 'legacy_' || old_name);
    RAISE NOTICE '000: stashed % -> legacy_%.', old_name, old_name;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS legacy_has_column(TEXT, TEXT);
