-- =====================================================================
-- WeBake migration 008: drop unused text_fil column from reviews
-- =====================================================================

ALTER TABLE public.reviews
  DROP COLUMN IF EXISTS text_fil;

