-- =====================================================================
-- WeBake migration 005: walk-in POS sales.
--
-- WHY separate tables instead of reusing orders: walk-in sales are anonymous
-- counter transactions (no customer, no downpayment, no lifecycle). They need
-- a receipt, not a state machine. Stock still moves through the SAME
-- stock_movements table (reason POS_SALE) so inventory stays unified.
-- =====================================================================

CREATE TABLE IF NOT EXISTS walkin_sales (
  id                      BIGSERIAL PRIMARY KEY,
  sale_code               TEXT NOT NULL UNIQUE,
  total_centavos          INTEGER NOT NULL CHECK (total_centavos >= 0),
  cash_received_centavos  INTEGER NOT NULL CHECK (cash_received_centavos >= 0),
  change_centavos         INTEGER NOT NULL CHECK (change_centavos >= 0),
  created_by              TEXT NOT NULL DEFAULT '',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_walkin_created ON walkin_sales (created_at DESC);

CREATE TABLE IF NOT EXISTS walkin_sale_items (
  id                    BIGSERIAL PRIMARY KEY,
  sale_id               BIGINT NOT NULL REFERENCES walkin_sales(id) ON DELETE CASCADE,
  product_id            BIGINT NULL REFERENCES products(id),
  product_name          TEXT NOT NULL,
  pieces_per_bundle     INTEGER NOT NULL CHECK (pieces_per_bundle > 0),
  unit                  TEXT NOT NULL CHECK (unit IN ('BUNDLE', 'PIECE')),
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  unit_price_centavos   INTEGER NOT NULL CHECK (unit_price_centavos >= 0),
  line_total_centavos   INTEGER NOT NULL CHECK (line_total_centavos >= 0)
);
CREATE INDEX IF NOT EXISTS idx_walkin_items_sale ON walkin_sale_items (sale_id);
