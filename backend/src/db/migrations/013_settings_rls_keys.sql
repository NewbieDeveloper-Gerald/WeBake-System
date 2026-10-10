-- =====================================================================
-- WeBake migration 013: Align RLS policy for settings table with real keys.
--
-- WHAT: Updates the public read policy on settings to include the actual
-- payment and bakery setting keys used across admin and customer checkout:
-- 'account_name', 'gcash_number', 'paymaya_number', 'gcash_qr', 'paymaya_qr',
-- 'store_hours', 'min_order_bundles', 'bakery_address'.
-- =====================================================================

DROP POLICY IF EXISTS "Public can read public settings" ON public.settings;

CREATE POLICY "Public can read public settings"
  ON public.settings
  FOR SELECT
  TO anon, authenticated
  USING (key IN (
    'account_name',
    'gcash_number',
    'paymaya_number',
    'gcash_qr',
    'paymaya_qr',
    'store_hours',
    'min_order_bundles',
    'bakery_address',
    'standard_delivery_fee',
    'downpayment_percentage',
    'support_phone',
    'support_email'
  ));

