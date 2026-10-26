-- =====================================================================
-- WeBake migration 020: Soft delete (is_archived) for ingredients
-- Preserves movement history, cost audit trail, and prevents data loss.
-- =====================================================================

-- 1) Drop view first so PostgreSQL allows column additions on base table
DROP VIEW IF EXISTS public.ingredient_stock_status CASCADE;

-- 2) Add is_archived column to ingredients table
ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Recreate ingredient_stock_status view including is_archived
CREATE OR REPLACE VIEW public.ingredient_stock_status
WITH (security_invoker = true) AS
SELECT i.*,
  CASE
    WHEN i.stock_quantity <= 0               THEN 'out_of_stock'
    WHEN i.stock_quantity <= i.reorder_level THEN 'low_stock'
    ELSE 'in_stock'
  END AS stock_status
FROM public.ingredients i;

