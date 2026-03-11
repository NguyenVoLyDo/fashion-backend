-- Migration 007: Loyalty points
-- Run as: psql $DATABASE_URL -f sql/migrations/007_loyalty.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         INT     NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    points_balance  INTEGER NOT NULL DEFAULT 0,
    tier            VARCHAR(20) NOT NULL DEFAULT 'bronze',
    total_earned    INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     INT     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points      INTEGER NOT NULL,
    reason      VARCHAR(100),
    ref_id      INT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS points_used     INTEGER       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS points_discount NUMERIC(10,2) NOT NULL DEFAULT 0;
