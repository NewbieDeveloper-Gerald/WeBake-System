-- =====================================================================
-- WeBake migration 006: cart_items normalized table
--
-- WHAT: Normalizes member cart items into public.cart_items (member_id, product_id, bundles)
-- while maintaining foreign keys to carts and products.
-- Populates existing cart items from carts.items JSONB column.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cart_items (
    member_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    bundles INTEGER NOT NULL CHECK (bundles > 0),

    PRIMARY KEY (member_id, product_id),

    CONSTRAINT cart_items_member_id_fkey
        FOREIGN KEY (member_id)
        REFERENCES public.carts (member_id)
        ON DELETE CASCADE,

    CONSTRAINT cart_items_product_id_fkey
        FOREIGN KEY (product_id)
        REFERENCES public.products (id)
        ON DELETE CASCADE
);

-- Enable Row Level Security
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

-- Add an index for product lookups
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id
ON public.cart_items (product_id);

-- Populate cart_items from existing carts.items JSONB column
INSERT INTO public.cart_items (member_id, product_id, bundles)
SELECT c.member_id,
       (item->>'product_id')::bigint,
       (item->>'bundles')::integer
FROM public.carts c,
     jsonb_array_elements(c.items) AS item
JOIN public.products p ON p.id = (item->>'product_id')::bigint
WHERE (item->>'bundles')::integer > 0
ON CONFLICT (member_id, product_id) DO UPDATE
SET bundles = EXCLUDED.bundles;
