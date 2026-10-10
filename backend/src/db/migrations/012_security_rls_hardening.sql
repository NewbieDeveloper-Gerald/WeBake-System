-- =====================================================================
-- WeBake migration 012: Database Row Level Security (RLS) hardening.
--
-- WHAT:
-- 1. Explicitly ensures Row Level Security (RLS) is ENABLED on all 17 tables.
-- 2. Sets least-privilege policies for PostgREST public roles ('anon', 'authenticated'):
--    - Public catalog tables ('products', 'reviews', 'settings') are READ-ONLY.
--    - Sensitive/transactional tables ('admins', 'members', 'carts', 'cart_items',
--      'orders', 'order_items', 'order_status_history', 'payments', 'otp_codes',
--      'refund_requests', 'stock_movements', 'walkin_sales', 'walkin_sale_items')
--      have NO public policies (default DENY for PostgREST).
--
-- WHY Express backend is unaffected:
-- The Express backend connects via DATABASE_URL as PostgreSQL user 'postgres',
-- which has rolbypassrls = true. All backend business logic, transactions, and
-- queries continue to execute at full speed without restriction.
-- =====================================================================

-- 1. Ensure RLS is enabled across every public table
ALTER TABLE IF EXISTS public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.walkin_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.walkin_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- 2. Public Read Policies for Storefront Catalog (Least Privilege)

-- Products: Anyone can view active (non-archived) products
DROP POLICY IF EXISTS "Public can read active products" ON public.products;
CREATE POLICY "Public can read active products"
  ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (is_archived = false);

-- Reviews: Anyone can read reviews
DROP POLICY IF EXISTS "Public can read reviews" ON public.reviews;
CREATE POLICY "Public can read reviews"
  ON public.reviews
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Settings: Only public bakery settings are exposed to anon
DROP POLICY IF EXISTS "Public can read public settings" ON public.settings;
CREATE POLICY "Public can read public settings"
  ON public.settings
  FOR SELECT
  TO anon, authenticated
  USING (key IN (
    'standard_delivery_fee',
    'downpayment_percentage',
    'bakery_address',
    'support_phone',
    'support_email',
    'payment_gcash_name',
    'payment_gcash_number',
    'payment_paymaya_name',
    'payment_paymaya_number'
  ));

-- 3. Explicitly revoke direct INSERT/UPDATE/DELETE from anon on public tables
REVOKE INSERT, UPDATE, DELETE ON public.products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.reviews FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.settings FROM anon;

