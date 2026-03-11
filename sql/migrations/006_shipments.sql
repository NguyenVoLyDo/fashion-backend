-- Migration 006: Add shipments table
-- Run as: psql $DATABASE_URL -f sql/migrations/006_shipments.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS shipments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id            INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    carrier             VARCHAR(80),
    tracking_number     VARCHAR(100),
    status              VARCHAR(40) NOT NULL DEFAULT 'pending',
    -- values: pending | picked_up | in_transit | out_for_delivery | delivered | failed
    carrier_data        JSONB,
    estimated_delivery  DATE,
    shipped_at          TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
