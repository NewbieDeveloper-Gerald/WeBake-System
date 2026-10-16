-- =====================================================================
-- Rollback 015: Remove Ingredients & Inventory Movements
-- =====================================================================

DROP VIEW IF EXISTS public.ingredient_stock_status;
DROP FUNCTION IF EXISTS public.adjust_stock(BIGINT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT);
DROP TABLE IF EXISTS public.inventory_movements CASCADE;
DROP TABLE IF EXISTS public.ingredients CASCADE;

