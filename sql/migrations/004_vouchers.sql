-- Migration 004: Add vouchers table and update orders
-- Run as: psql $DATABASE_URL -f sql/migrations/004_vouchers.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS vouchers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(50)  NOT NULL UNIQUE,
    type            VARCHAR(20)  NOT NULL CHECK (type IN ('percent','fixed','free_ship')),
    value           NUMERIC(10,2) NOT NULL,
    min_order_value NUMERIC(12,2) DEFAULT 0,
    max_discount    NUMERIC(12,2),
    usage_limit     INTEGER,
    used_count      INTEGER      NOT NULL DEFAULT 0,
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS voucher_id      UUID REFERENCES vouchers(id),
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
