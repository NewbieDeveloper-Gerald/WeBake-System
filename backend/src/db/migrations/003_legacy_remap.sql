-- =====================================================================
-- WeBake migration 003: one-time import from STASHED legacy tables
-- (legacy_*, renamed by migration 000). Fresh databases have no legacy_*
-- tables, so every block below skips silently and the file is a no-op.
-- All inserts carry NOT EXISTS guards, so re-running never duplicates rows.
--
-- KNOWN LIMITS (read before running against a real legacy DB):
-- 1. Old money was NUMERIC pesos; it converts with ROUND(x*100). Spot-check:
--    SELECT order_code, total_centavos/100.0 FROM orders ORDER BY id DESC LIMIT 5;
-- 2. Old password hashes were PBKDF2, the new stack verifies bcrypt. Imported
--    members MUST use "forgot password" once - their old password stops
--    working. (Their hash is prefixed LEGACY_PBKDF2_MUST_RESET__ so it can
--    never accidentally verify.) Announce this to customers.
-- 3. The legacy schema tracked no stock counts: imported products start at
--    stock_pieces = 0. Count the shelves, then use inventory adjust.
-- 4. Legacy cancellation_requested/refunded orders become CANCELLED with a
--    refund_requests row. Legacy rows WITH an account number import as
--    PENDING; rows WITHOUT one import as AWAITING_DETAILS (customer submits).
-- 5. No admin accounts are imported (old roles model retired). The owner
--    account comes from `npm run seed`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. legacy_users -> members (addresses backfilled in step 1b)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.legacy_users') IS NULL THEN
    RAISE NOTICE '003: no legacy_users, skipping members import.';
    RETURN;
  END IF;

  INSERT INTO members (full_name, email, email_verified_at, contact, address, password_hash, locale)
  SELECT
    COALESCE(NULLIF(TRIM(u.full_name), ''), 'Legacy Customer'),
    LOWER(TRIM(u.email_address)),
    NOW(),
    COALESCE(NULLIF(TRIM(u.contact_number), ''), '09000000000'),
    '',
    'LEGACY_PBKDF2_MUST_RESET__' || COALESCE(u.password_hash, ''),
    'en'
  FROM legacy_users u
  WHERE u.email_address IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM members m WHERE m.email = LOWER(TRIM(u.email_address)));

  -- 1b. Default address per member (only when the legacy table exists).
  IF to_regclass('public.legacy_user_addresses') IS NOT NULL THEN
    UPDATE members m SET address = sub.address_line1
    FROM (
      SELECT DISTINCT ON (LOWER(TRIM(u.email_address)))
             LOWER(TRIM(u.email_address)) AS email, a.address_line1
        FROM legacy_users u
        JOIN legacy_user_addresses a ON a.user_id = u.id
       ORDER BY LOWER(TRIM(u.email_address)), a.is_default DESC NULLS LAST
    ) sub
    WHERE m.email = sub.email AND (m.address = '' OR m.address IS NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. legacy products + bundles -> products (first active bundle wins)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.legacy_products') IS NULL THEN
    RAISE NOTICE '003: no legacy_products, skipping products import.';
    RETURN;
  END IF;

  INSERT INTO products (name, slug, description, price_bundle_centavos,
                        pieces_per_bundle, piece_price_centavos,
                        stock_pieces, low_stock_threshold_pieces, image_url, is_archived)
  SELECT
    p.product_name,
    COALESCE(NULLIF(p.slug, ''), 'legacy-' || p.id),
    COALESCE(p.description, ''),
    GREATEST(1, ROUND(COALESCE(b.wholesale_price, 105) * 100)::int),
    COALESCE(b.pieces_per_bundle, 25),
    GREATEST(1, (ROUND(COALESCE(b.wholesale_price, 105) * 100)
                 / COALESCE(b.pieces_per_bundle, 25))::int),
    0,
    500,
    COALESCE(p.image_url, ''),
    NOT COALESCE(p.is_active, TRUE)
  FROM legacy_products p
  LEFT JOIN LATERAL (
    SELECT * FROM legacy_product_bundles b
     WHERE b.product_id = p.id
     ORDER BY b.is_active DESC NULLS LAST, b.id ASC
     LIMIT 1
  ) b ON TRUE
  WHERE NOT EXISTS (SELECT 1 FROM products np WHERE np.name = p.product_name);
END $$;

-- ---------------------------------------------------------------------
-- 3. Status remap helper (temporary, dropped at end of file)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION legacy_status_map(old_status TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE LOWER(COALESCE(old_status, ''))
    WHEN 'pending' THEN 'PAYMENT_UNDER_VERIFICATION'
    WHEN 'downpayment_confirmed' THEN 'CONFIRMED'
    WHEN 'baking' THEN 'IN_PRODUCTION'
    WHEN 'in_production' THEN 'IN_PRODUCTION'
    WHEN 'out_for_delivery' THEN 'OUT_FOR_DELIVERY'
    WHEN 'delivered' THEN 'COMPLETED'
    WHEN 'completed' THEN 'COMPLETED'
    WHEN 'cancelled' THEN 'CANCELLED'
    WHEN 'cancellation_requested' THEN 'CANCELLED'
    WHEN 'refunded' THEN 'CANCELLED'
    ELSE 'PAYMENT_UNDER_VERIFICATION'
  END;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 4. legacy_orders -> orders (NUMERIC pesos -> INTEGER centavos)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.legacy_orders') IS NULL THEN
    RAISE NOTICE '003: no legacy_orders, skipping orders import.';
    RETURN;
  END IF;

  INSERT INTO orders
    (order_code, member_id, customer_name, customer_email, customer_contact,
     delivery_address, delivery_date, delivery_time, notes,
     subtotal_centavos, total_centavos, downpayment_centavos,
     downpayment_paid_centavos, balance_due_centavos, payment_method,
     status, created_at, updated_at)
  SELECT
    o.order_code,
    (SELECT m.id FROM members m WHERE m.email = LOWER(TRIM(o.customer_email)) LIMIT 1),
    COALESCE(o.customer_name, 'Legacy Customer'),
    LOWER(TRIM(COALESCE(o.customer_email, 'unknown@legacy.local'))),
    COALESCE(o.customer_contact, ''),
    COALESCE(o.delivery_address, ''),
    -- delivery_date type varied across legacy revisions; accept only clean
    -- YYYY-MM-DD text, otherwise NULL (better NULL than a failed migration).
    CASE WHEN o.delivery_date::text ~ '^\d{4}-\d{2}-\d{2}'
         THEN (o.delivery_date::text)::date ELSE NULL END,
    COALESCE(o.delivery_time, ''),
    COALESCE(o.special_notes, ''),
    ROUND(COALESCE(o.subtotal_amount, 0) * 100)::int,
    ROUND(COALESCE(o.grand_total, 0) * 100)::int,
    ROUND(COALESCE(o.downpayment_required, 0) * 100)::int,
    ROUND(COALESCE(o.downpayment_paid, 0) * 100)::int,
    ROUND(COALESCE(o.balance_due, 0) * 100)::int,
    CASE WHEN LOWER(COALESCE(o.payment_method, '')) LIKE '%maya%' THEN 'MAYA' ELSE 'GCASH' END,
    legacy_status_map(o.status),
    COALESCE(o.created_at, NOW()),
    COALESCE(o.updated_at, NOW())
  FROM legacy_orders o
  WHERE NOT EXISTS (SELECT 1 FROM orders no WHERE no.order_code = o.order_code);
END $$;

-- ---------------------------------------------------------------------
-- 5. items + payments + history + cancellations (best-effort, guarded)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.legacy_order_items') IS NOT NULL THEN
    INSERT INTO order_items
      (order_id, product_id, product_name, pieces_per_bundle, bundles,
       unit_price_centavos, line_total_centavos)
    SELECT
      no.id,
      (SELECT np.id FROM products np WHERE np.name = oi.product_name LIMIT 1),
      oi.product_name,
      COALESCE(oi.pieces_per_bundle, 25),
      GREATEST(1, COALESCE(oi.quantity, 1)),
      ROUND(COALESCE(oi.unit_price, 0) * 100)::int,
      ROUND(COALESCE(oi.total_price, 0) * 100)::int
    FROM legacy_order_items oi
    JOIN legacy_orders o ON o.id = oi.order_id
    JOIN orders no ON no.order_code = o.order_code
    WHERE NOT EXISTS (
      SELECT 1 FROM order_items noi
       WHERE noi.order_id = no.id AND noi.product_name = oi.product_name
    );
  END IF;

  IF to_regclass('public.legacy_payments') IS NOT NULL THEN
    INSERT INTO payments
      (order_id, stage, channel, amount_centavos, reference_number,
       proof_storage_path, verification_status, verified_at, created_at)
    SELECT
      no.id,
      CASE WHEN LOWER(COALESCE(p.payment_stage, '')) LIKE '%balance%' THEN 'BALANCE' ELSE 'DOWNPAYMENT' END,
      CASE WHEN LOWER(COALESCE(p.payment_channel, '')) LIKE '%maya%' THEN 'MAYA'
           WHEN LOWER(COALESCE(p.payment_channel, '')) LIKE '%cash%' THEN 'CASH'
           ELSE 'GCASH' END,
      ROUND(COALESCE(p.amount, 0) * 100)::int,
      COALESCE(p.reference_number, ''),
      '',
      CASE WHEN LOWER(COALESCE(p.verification_status, '')) = 'verified' THEN 'VERIFIED' ELSE 'PENDING' END,
      p.verified_at,
      COALESCE(p.created_at, NOW())
    FROM legacy_payments p
    JOIN legacy_orders o ON o.id = p.order_id
    JOIN orders no ON no.order_code = o.order_code;
  END IF;

  IF to_regclass('public.legacy_order_status_history') IS NOT NULL THEN
    INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_at, note)
    SELECT
      no.id,
      CASE WHEN h.previous_status IS NULL THEN NULL ELSE legacy_status_map(h.previous_status) END,
      legacy_status_map(h.new_status),
      'SYSTEM',
      COALESCE(h.created_at, NOW()),
      COALESCE(h.notes, 'Imported from legacy history.')
    FROM legacy_order_status_history h
    JOIN legacy_orders o ON o.id = h.order_id
    JOIN orders no ON no.order_code = o.order_code;
  END IF;

  IF to_regclass('public.legacy_cancellation_requests') IS NOT NULL THEN
    INSERT INTO refund_requests
      (order_id, reason, reason_source, wallet_type, account_number, account_name,
       refund_amount_centavos, status, requested_at, admin_note)
    SELECT
      no.id,
      COALESCE(NULLIF(TRIM(cr.reason), ''), 'Imported legacy cancellation'),
      'CUSTOMER',
      CASE WHEN LOWER(COALESCE(cr.refund_channel, '')) LIKE '%maya%' THEN 'PAYMAYA'
           WHEN LOWER(COALESCE(cr.refund_channel, '')) LIKE '%gcash%'
             OR LOWER(COALESCE(cr.refund_channel, '')) LIKE '%cash%' THEN 'GCASH'
           ELSE NULL END,
      COALESCE(cr.refund_account_number, ''),
      COALESCE(cr.refund_account_name, ''),
      ROUND(COALESCE(cr.eligible_refund_amount, no.downpayment_centavos / 100.0) * 100)::int,
      CASE LOWER(COALESCE(cr.status, ''))
        WHEN 'processed' THEN 'REFUNDED'
        WHEN 'rejected' THEN 'CLOSED_NO_PAYMENT'
        WHEN 'pending_review' THEN
          CASE WHEN COALESCE(TRIM(cr.refund_account_number), '') <> ''
               THEN 'PENDING' ELSE 'AWAITING_DETAILS' END
        ELSE 'AWAITING_DETAILS' END,
      COALESCE(cr.created_at, NOW()),
      COALESCE(cr.rejection_reason, '')
    FROM legacy_cancellation_requests cr
    JOIN legacy_orders o ON o.id = cr.order_id
    JOIN orders no ON no.order_code = o.order_code
    WHERE NOT EXISTS (SELECT 1 FROM refund_requests rr WHERE rr.order_id = no.id);
  END IF;
END $$;

DROP FUNCTION IF EXISTS legacy_status_map(TEXT);
