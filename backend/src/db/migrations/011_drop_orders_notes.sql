-- =====================================================================
-- WeBake migration 011: drop unused notes column from orders
-- =====================================================================

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS notes;

