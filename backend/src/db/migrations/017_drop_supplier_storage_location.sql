-- =====================================================================
-- Migration 017: Completely drop supplier & storage_location
-- Safe, clean, and idempotent for PostgreSQL / Supabase
-- =====================================================================

-- 1) Drop view first so PostgreSQL allows column removal without dependency errors
DROP VIEW IF EXISTS public.ingredient_stock_status CASCADE;

-- 2) Drop unused columns from ingredients table if they still exist
ALTER TABLE public.ingredients
  DROP COLUMN IF EXISTS supplier,
  DROP COLUMN IF EXISTS storage_location;

-- 3) Drop unused supplier column from inventory_movements table if it still exists
ALTER TABLE public.inventory_movements
  DROP COLUMN IF EXISTS supplier;

-- 4) Recreate ingredient_stock_status view strictly with active columns + stock_status
CREATE OR REPLACE VIEW public.ingredient_stock_status
WITH (security_invoker = true) AS
SELECT i.*,
  CASE
    WHEN i.stock_quantity <= 0               THEN 'out_of_stock'
    WHEN i.stock_quantity <= i.reorder_level THEN 'low_stock'
    ELSE 'in_stock'
  END AS stock_status
FROM public.ingredients i;
