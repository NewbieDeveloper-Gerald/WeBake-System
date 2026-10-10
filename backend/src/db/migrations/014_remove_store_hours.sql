-- =====================================================================
-- WeBake migration 014: Remove store_hours from database and RLS policy.
--
-- WHAT: Deletes the store_hours row from the settings table and updates
-- the public read RLS policy to no longer include store_hours.
-- =====================================================================

-- Delete store_hours key from settings table
DELETE FROM public.settings WHERE key = 'store_hours';

-- Update RLS policy to drop store_hours
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
    'min_order_bundles',
    'bakery_address',
    'standard_delivery_fee',
    'downpayment_percentage',
    'support_phone',
    'support_email'
  ));

