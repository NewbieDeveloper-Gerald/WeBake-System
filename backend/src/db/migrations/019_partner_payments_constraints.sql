-- Migration 019: Expand payments stage and channel check constraints for partner payments

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_stage_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_stage_check CHECK (stage IN ('DOWNPAYMENT', 'BALANCE', 'PARTNER'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_channel_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_channel_check CHECK (channel IN ('GCASH', 'MAYA', 'CASH', 'BANK_TRANSFER', 'OTHER'));

