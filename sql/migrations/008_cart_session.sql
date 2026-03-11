-- Migration 008: Guest cart support (session_id)
-- Makes user_id nullable, adds session_id column
-- Run as: psql $DATABASE_URL -f sql/migrations/008_cart_session.sql

-- 1. Drop old UNIQUE constraint on user_id (will re-add as partial index)
ALTER TABLE carts DROP CONSTRAINT IF EXISTS carts_user_id_key;

-- 2. Make user_id nullable (guest carts have no user)
ALTER TABLE carts ALTER COLUMN user_id DROP NOT NULL;

-- 3. Add session_id column for anonymous/guest carts
ALTER TABLE carts ADD COLUMN IF NOT EXISTS session_id UUID;

-- 4. Add price_at to cart_items (needed for cart queries)
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS price_at NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 5. Add added_at timestamp to cart_items
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 6. One cart per user (partial unique index — allows multiple NULL user_id rows)
CREATE UNIQUE INDEX IF NOT EXISTS carts_user_id_unique
    ON carts (user_id)
    WHERE user_id IS NOT NULL;

-- 7. One cart per session (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS carts_session_id_unique
    ON carts (session_id)
    WHERE session_id IS NOT NULL;

-- 8. A cart must have either user_id or session_id
ALTER TABLE carts DROP CONSTRAINT IF EXISTS carts_identity_check;
ALTER TABLE carts ADD CONSTRAINT carts_identity_check
    CHECK (user_id IS NOT NULL OR session_id IS NOT NULL);
