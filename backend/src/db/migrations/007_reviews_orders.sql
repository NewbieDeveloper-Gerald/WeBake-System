-- =====================================================================
-- WeBake migration 007: link customer reviews to orders and products
-- =====================================================================

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS order_id BIGINT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS member_id BIGINT NULL REFERENCES members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_order ON reviews (order_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_member ON reviews (member_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_order_product
  ON reviews (order_id, product_id)
  WHERE order_id IS NOT NULL AND product_id IS NOT NULL;

