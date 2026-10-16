-- =====================================================================
-- Rollback: Remove Ingredients & Inventory Movements
-- Safe and clean: drops only what migration.sql created
-- =====================================================================

DROP VIEW IF EXISTS public.ingredient_stock_status;
DROP FUNCTION IF EXISTS public.adjust_stock(BIGINT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT);
DROP TABLE IF EXISTS public.inventory_movements CASCADE;
DROP TABLE IF EXISTS public.ingredients CASCADE;

