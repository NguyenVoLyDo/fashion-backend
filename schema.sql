-- Fashion store schema
-- Run as: psql -U postgres -d fashion_store -f schema.sql

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    full_name     VARCHAR(255) NOT NULL,
    phone         VARCHAR(20),
    role          VARCHAR(20)  NOT NULL DEFAULT 'customer',
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Addresses ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS addresses (
    id          SERIAL PRIMARY KEY,
    user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name   VARCHAR(255) NOT NULL,
    phone       VARCHAR(20)  NOT NULL,
    address     TEXT         NOT NULL,
    city        VARCHAR(100),
    is_default  BOOLEAN      NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Refresh tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64)  NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Categories ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(255) NOT NULL UNIQUE,
    parent_id   INT REFERENCES categories(id),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Products ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id           SERIAL PRIMARY KEY,
    category_id  INT REFERENCES categories(id),
    name         VARCHAR(255) NOT NULL,
    slug         VARCHAR(255) NOT NULL UNIQUE,
    description  TEXT,
    base_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active    BOOLEAN      NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Product images ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
    id          SERIAL PRIMARY KEY,
    product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    sort_order  INT NOT NULL DEFAULT 0
);

-- ── Colors ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS colors (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL UNIQUE,
    hex   CHAR(7)
);

-- ── Sizes ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sizes (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(20) NOT NULL UNIQUE
);

-- ── Product variants ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
    id          SERIAL PRIMARY KEY,
    product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    color_id    INT REFERENCES colors(id),
    size_id     INT REFERENCES sizes(id),
    sku         VARCHAR(100) UNIQUE,
    price       NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock       INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Carts ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carts (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Cart items ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cart_items (
    id          SERIAL PRIMARY KEY,
    cart_id     INT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    variant_id  INT NOT NULL REFERENCES product_variants(id),
    quantity    INT NOT NULL DEFAULT 1,
    UNIQUE (cart_id, variant_id)
);

-- ── Orders ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id),
    address_id      INT REFERENCES addresses(id),
    total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    status          VARCHAR(50)   NOT NULL DEFAULT 'pending',
    note            TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Order items ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id  INT REFERENCES product_variants(id),
    quantity    INT           NOT NULL,
    unit_price  NUMERIC(12,2) NOT NULL
);

-- ── Order status log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_status_log (
    id          SERIAL PRIMARY KEY,
    order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status      VARCHAR(50) NOT NULL,
    note        TEXT,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Payments ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id              SERIAL PRIMARY KEY,
    order_id        INT NOT NULL REFERENCES orders(id),
    method          VARCHAR(50) NOT NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',
    amount          NUMERIC(12,2) NOT NULL,
    transaction_id  VARCHAR(255),
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
