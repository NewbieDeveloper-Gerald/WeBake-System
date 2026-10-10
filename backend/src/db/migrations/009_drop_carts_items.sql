-- =====================================================================
-- WeBake migration 009: drop redundant items JSONB column from carts
-- Cart items are normalized in public.cart_items (migration 006)
-- =====================================================================

ALTER TABLE public.carts
  DROP COLUMN IF EXISTS items;

