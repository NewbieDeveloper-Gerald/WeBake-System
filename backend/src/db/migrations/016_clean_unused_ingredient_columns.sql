-- =====================================================================
-- WeBake migration 016: Drop unused columns (supplier, storage_location)
-- from ingredients and inventory_movements.
-- Clean schema for production and academic evaluation.
-- =====================================================================

-- 1) Drop view first to allow column removal without dependency errors
DROP VIEW IF EXISTS public.ingredient_stock_status CASCADE;

-- 2) Drop unused columns from ingredients table
ALTER TABLE public.ingredients
  DROP COLUMN IF EXISTS supplier,
  DROP COLUMN IF EXISTS storage_location;

-- 3) Drop unused supplier column from inventory_movements table
ALTER TABLE public.inventory_movements
  DROP COLUMN IF EXISTS supplier;

-- 4) Drop old 7-argument adjust_stock function to prevent signature conflict
DROP FUNCTION IF EXISTS public.adjust_stock(BIGINT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT);

-- 5) Recreate adjust_stock RPC without supplier parameter or column assignments
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_ingredient_id BIGINT,
  p_type          TEXT,
  p_quantity      NUMERIC,
  p_reason        TEXT    DEFAULT NULL,
  p_unit_cost     NUMERIC DEFAULT NULL,
  p_actor         TEXT    DEFAULT 'admin'
)
RETURNS public.inventory_movements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before NUMERIC;
  v_change NUMERIC;
  v_after  NUMERIC;
  v_row    public.inventory_movements;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  IF p_type NOT IN ('restock','usage','adjustment','waste') THEN
    RAISE EXCEPTION 'Invalid movement type: %', p_type;
  END IF;

  IF p_type <> 'restock' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  -- Lock target row to prevent race conditions
  SELECT stock_quantity INTO v_before
  FROM public.ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found';
  END IF;

  v_change := CASE WHEN p_type = 'restock' THEN p_quantity ELSE -p_quantity END;
  v_after  := v_before + v_change;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'Insufficient stock (available: %)', v_before;
  END IF;

  -- Update ingredient master record
  UPDATE public.ingredients
  SET stock_quantity   = v_after,
      stock_updated_at = NOW(),
      cost_per_unit    = COALESCE(p_unit_cost, cost_per_unit)
  WHERE id = p_ingredient_id;

  -- Record audit trail
  INSERT INTO public.inventory_movements
    (ingredient_id, movement_type, quantity_change, quantity_before,
     quantity_after, unit_cost, reason, created_by)
  VALUES
    (p_ingredient_id, p_type, v_change, v_before,
     v_after, p_unit_cost, p_reason, COALESCE(p_actor, 'admin'))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 6) Recreate ingredient_stock_status view strictly with active columns + stock_status
CREATE OR REPLACE VIEW public.ingredient_stock_status
WITH (security_invoker = true) AS
SELECT i.*,
  CASE
    WHEN i.stock_quantity <= 0               THEN 'out_of_stock'
    WHEN i.stock_quantity <= i.reorder_level THEN 'low_stock'
    ELSE 'in_stock'
  END AS stock_status
FROM public.ingredients i;

