-- =====================================================================
-- WeBake migration 010: drop unused columns (delivery scheduling, slug, locale)
-- Clean schema for production and academic evaluation
-- =====================================================================

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS delivery_date,
  DROP COLUMN IF EXISTS delivery_time;

ALTER TABLE public.members
  DROP COLUMN IF EXISTS locale;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS slug;

