-- =====================================================================
-- Migration 015: Add Ingredients & Inventory Movements (WeBake)
-- Compatible with PostgreSQL / Supabase
-- =====================================================================

-- 1) Ingredients catalog table
CREATE TABLE IF NOT EXISTS public.ingredients (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  stock_quantity    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  unit              TEXT NOT NULL DEFAULT 'pcs',
  reorder_level     NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  cost_per_unit     NUMERIC(12,2),
  supplier          TEXT,
  expiry_date       DATE,
  storage_location  TEXT,
  stock_updated_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingredients_name ON public.ingredients (name);
CREATE INDEX IF NOT EXISTS idx_ingredients_expiry ON public.ingredients (expiry_date);

-- Auto-update updated_at timestamp on row changes
DROP TRIGGER IF EXISTS trg_ingredients_updated ON public.ingredients;
CREATE TRIGGER trg_ingredients_updated BEFORE UPDATE ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) History / audit ledger table (ingredient_id matches ingredients.id BIGINT)
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id              BIGSERIAL PRIMARY KEY,
  ingredient_id   BIGINT NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  movement_type   TEXT NOT NULL CHECK (movement_type IN ('restock','usage','adjustment','waste')),
  quantity_change NUMERIC(12,3) NOT NULL,
  quantity_before NUMERIC(12,3) NOT NULL,
  quantity_after  NUMERIC(12,3) NOT NULL,
  unit_cost       NUMERIC(12,2),
  supplier        TEXT,
  reason          TEXT,
  created_by      TEXT NOT NULL DEFAULT 'admin',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movements_ingredient
  ON public.inventory_movements (ingredient_id, created_at DESC);

-- 3) Safe stock adjustment RPC: row lock + audit log + negative stock prevention in one transaction
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_ingredient_id BIGINT,
  p_type          TEXT,
  p_quantity      NUMERIC,
  p_reason        TEXT    DEFAULT NULL,
  p_unit_cost     NUMERIC DEFAULT NULL,
  p_supplier      TEXT    DEFAULT NULL,
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
      cost_per_unit    = COALESCE(p_unit_cost, cost_per_unit),
      supplier         = COALESCE(p_supplier, supplier)
  WHERE id = p_ingredient_id;

  -- Record audit trail
  INSERT INTO public.inventory_movements
    (ingredient_id, movement_type, quantity_change, quantity_before,
     quantity_after, unit_cost, supplier, reason, created_by)
  VALUES
    (p_ingredient_id, p_type, v_change, v_before,
     v_after, p_unit_cost, p_supplier, p_reason, COALESCE(p_actor, 'admin'))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 4) Ingredient stock status view
CREATE OR REPLACE VIEW public.ingredient_stock_status
WITH (security_invoker = true) AS
SELECT i.*,
  CASE
    WHEN i.stock_quantity <= 0               THEN 'out_of_stock'
    WHEN i.stock_quantity <= i.reorder_level THEN 'low_stock'
    ELSE 'in_stock'
  END AS stock_status
FROM public.ingredients i;

-- 5) Row Level Security (RLS) policies aligned with WeBake security standard
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.ingredients FROM anon;
REVOKE ALL ON public.inventory_movements FROM anon;

