-- Migration 018: Additive support for manual partner payments and tracking
-- Safe: only adds nullable/defaulted columns, never drops or renames existing columns/tables.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS recorded_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS voided_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS void_reason TEXT DEFAULT '';

-- Expand stage check to allow PARTNER payments
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_stage_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_stage_check CHECK (stage IN ('DOWNPAYMENT', 'BALANCE', 'PARTNER'));

-- Expand channel check to allow BANK_TRANSFER and OTHER
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_channel_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_channel_check CHECK (channel IN ('GCASH', 'MAYA', 'CASH', 'BANK_TRANSFER', 'OTHER'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS amount_paid_centavos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'UNPAID';

-- Backfill amount_paid_centavos and payment_status for any existing orders
UPDATE public.orders
   SET amount_paid_centavos = GREATEST(0, total_centavos - COALESCE(balance_due_centavos, 0)),
       payment_status = CASE
         WHEN status = 'CANCELLED' THEN 'CANCELLED'
         WHEN COALESCE(balance_due_centavos, 0) <= 0 THEN 'PAID'
         WHEN COALESCE(balance_due_centavos, 0) < total_centavos THEN 'PARTIAL'
         ELSE 'UNPAID'
       END
 WHERE payment_status IS NULL OR payment_status = 'UNPAID';

