-- Migration 005: Add product reviews table
-- Run as: psql $DATABASE_URL -f sql/migrations/005_reviews.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS reviews CASCADE;

CREATE TABLE IF NOT EXISTS reviews (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id  INT      NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
    user_id     INT      NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    order_id    INT               REFERENCES orders(id),
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title       VARCHAR(200),
    body        TEXT,
    is_verified BOOLEAN  NOT NULL DEFAULT FALSE,
    is_visible  BOOLEAN  NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ       DEFAULT NOW(),
    UNIQUE (product_id, user_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, is_visible);
