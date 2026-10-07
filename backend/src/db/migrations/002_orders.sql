-- =====================================================================
-- WeBake migration 002: orders, payments, refunds, history, stock movements.
--
-- DESIGN NOTES:
-- 1. Statuses are TEXT with CHECK constraints (not PG enums) so future states
--    need only a constraint change, and values stay readable in every tool.
--    The allowed lists mirror src/utils/orderMachine.js - change both together.
-- 2. order_items snapshots product_name + prices at purchase time. If the owner
--    later renames a product or changes PHP 105, old receipts stay truthful.
-- 3. refund_requests.order_id is UNIQUE: one refund per order, enforced by the
--    database, not just by application code (race-proof).
-- 4. stock_movements is append-only: the API never UPDATEs or DELETEs rows.
--    Current stock = products.stock_pieces; movements = the audit trail.
-- =====================================================================

-- ---------------------------------------------------------------------
-- orders: one row per online order (walk-in POS sales record through
-- stock_movements + payments summaries in Phase 5, not as orders).
-- member_id is NULL for guest checkout until the email links to a member.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                      BIGSERIAL PRIMARY KEY,
  order_code              TEXT NOT NULL UNIQUE,
  member_id               BIGINT NULL REFERENCES members(id) ON DELETE SET NULL,
  customer_name           TEXT NOT NULL,
  customer_email          TEXT NOT NULL,
  customer_contact        TEXT NOT NULL,
  delivery_address        TEXT NOT NULL,
  delivery_date           DATE NULL,
  delivery_time           TEXT NOT NULL DEFAULT '',
  notes                   TEXT NOT NULL DEFAULT '',
  subtotal_centavos       INTEGER NOT NULL CHECK (subtotal_centavos >= 0),
  total_centavos          INTEGER NOT NULL CHECK (total_centavos >= 0),
  downpayment_centavos    INTEGER NOT NULL CHECK (downpayment_centavos >= 0),
  downpayment_paid_centavos INTEGER NOT NULL DEFAULT 0 CHECK (downpayment_paid_centavos >= 0),
  balance_due_centavos    INTEGER NOT NULL CHECK (balance_due_centavos >= 0),
  payment_method          TEXT NOT NULL CHECK (payment_method IN ('GCASH', 'MAYA')),
  status                  TEXT NOT NULL DEFAULT 'PAYMENT_UNDER_VERIFICATION'
                          CHECK (status IN ('PAYMENT_UNDER_VERIFICATION', 'CONFIRMED',
                                           'IN_PRODUCTION', 'OUT_FOR_DELIVERY',
                                           'COMPLETED', 'CANCELLED')),
  rejection_reason        TEXT NOT NULL DEFAULT '',
  resubmit_count          INTEGER NOT NULL DEFAULT 0 CHECK (resubmit_count >= 0),
  idempotency_key         TEXT NULL UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders (customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_member ON orders (member_id);

-- ---------------------------------------------------------------------
-- order_items: line items with price/name snapshots (see note 2 above).
-- bundles is always whole bundles (online rule); POS piece sales never
-- create order_items - they only move stock (Phase 5).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id                    BIGSERIAL PRIMARY KEY,
  order_id              BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id            BIGINT NULL REFERENCES products(id),
  product_name          TEXT NOT NULL,
  pieces_per_bundle     INTEGER NOT NULL CHECK (pieces_per_bundle > 0),
  bundles               INTEGER NOT NULL CHECK (bundles > 0),
  unit_price_centavos   INTEGER NOT NULL CHECK (unit_price_centavos >= 0),
  line_total_centavos   INTEGER NOT NULL CHECK (line_total_centavos >= 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- ---------------------------------------------------------------------
-- payments: downpayment submissions + cash balance records.
-- proof_storage_path points into the PRIVATE Supabase bucket (Phase 4);
-- empty string until a proof is uploaded.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                  BIGSERIAL PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage               TEXT NOT NULL CHECK (stage IN ('DOWNPAYMENT', 'BALANCE')),
  channel             TEXT NOT NULL CHECK (channel IN ('GCASH', 'MAYA', 'CASH')),
  amount_centavos     INTEGER NOT NULL CHECK (amount_centavos >= 0),
  reference_number    TEXT NOT NULL DEFAULT '',
  proof_storage_path  TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  verified_at         TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);

-- ---------------------------------------------------------------------
-- refund_requests: EXACT spec shape. Wallet columns stay empty while status
-- is AWAITING_DETAILS (admin rejection before the customer responds).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refund_requests (
  id                      BIGSERIAL PRIMARY KEY,
  order_id                BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  reason                  TEXT NOT NULL,
  reason_source           TEXT NOT NULL CHECK (reason_source IN ('CUSTOMER', 'ADMIN_REJECTION')),
  wallet_type             TEXT NULL CHECK (wallet_type IN ('GCASH', 'PAYMAYA')),
  account_number          TEXT NOT NULL DEFAULT '',
  account_name            TEXT NOT NULL DEFAULT '',
  refund_amount_centavos  INTEGER NOT NULL CHECK (refund_amount_centavos >= 0),
  status                  TEXT NOT NULL
                          CHECK (status IN ('AWAITING_DETAILS', 'PENDING',
                                           'REFUNDED', 'CLOSED_NO_PAYMENT')),
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at            TIMESTAMPTZ NULL,
  admin_reference_number  TEXT NOT NULL DEFAULT '',
  admin_note              TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refund_requests (status);

-- ---------------------------------------------------------------------
-- order_status_history: one row per status change, no exceptions.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_status_history (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status  TEXT NULL,
  new_status  TEXT NOT NULL,
  changed_by  TEXT NOT NULL CHECK (changed_by IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_history_order ON order_status_history (order_id);

-- ---------------------------------------------------------------------
-- stock_movements: append-only audit trail (see note 4 above).
-- change_pieces is SIGNED: negative for sales/deductions, positive for
-- restocks and cancellation returns.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id),
  change_pieces   INTEGER NOT NULL CHECK (change_pieces <> 0),
  reason          TEXT NOT NULL CHECK (reason IN ('APPROVAL_DEDUCTION',
                                                 'CANCELLATION_RETURN',
                                                 'POS_SALE', 'RESTOCK', 'ADJUSTMENT')),
  order_id        BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements (created_at DESC);

-- Auto-touch for orders (same helper from migration 001).
DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
