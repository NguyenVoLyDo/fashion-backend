import {
    describe,
    it,
    expect,
    beforeAll,
    afterAll,
} from 'vitest';
import request from 'supertest';
import pg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import app from '../src/app.js';

// ── Test DB pool ──────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Insert a test user directly and return a signed JWT access token.
 * @param {{ email: string, role: 'admin'|'customer' }} opts
 */
async function createTestUser({ email, role }) {
    const passwordHash = await bcrypt.hash('password123', 10);
    const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
         RETURNING id, email, role`,
        [email, passwordHash, 'Test User', role],
    );
    const user = rows[0];
    const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '15m' },
    );
    return { user, token };
}

// ── Seed data ─────────────────────────────────────────────────────────────────

let adminToken;
let customerToken;
let activeProductSlug;
let variantId;

beforeAll(async () => {
    // Truncate catalog tables (preserve users for token helper)
    await pool.query(`
        TRUNCATE TABLE
            product_variants,
            product_images,
            products,
            categories,
            colors,
            sizes
        RESTART IDENTITY CASCADE
    `);
    await pool.query('TRUNCATE TABLE users, refresh_tokens RESTART IDENTITY CASCADE');

    // Tokens
    const admin = await createTestUser({ email: 'admin@fashion.vn', role: 'admin' });
    const customer = await createTestUser({ email: 'customer@fashion.vn', role: 'customer' });
    adminToken = admin.token;
    customerToken = customer.token;

    // Categories: parent "Áo" + child "Áo thun"
    const { rows: catRows } = await pool.query(`
        INSERT INTO categories (name, slug) VALUES ('Áo', 'ao') RETURNING id
    `);
    const parentId = catRows[0].id;
    await pool.query(
        `INSERT INTO categories (name, slug, parent_id) VALUES ('Áo thun', 'ao-thun', $1)`,
        [parentId],
    );

    // Colors & sizes
    const { rows: colorRows } = await pool.query(`
        INSERT INTO colors (name) VALUES ('Trắng'), ('Đen') RETURNING id
    `);
    const { rows: sizeRows } = await pool.query(`
        INSERT INTO sizes (name) VALUES ('S'), ('M') RETURNING id
    `);
    const whiteId = colorRows[0].id;
    const sId = sizeRows[0].id;

    // Active product with 2 variants + 1 image
    const { rows: prodRows } = await pool.query(`
        INSERT INTO products (category_id, name, slug, description, base_price, is_active)
        VALUES ($1, 'Áo thun trắng', 'ao-thun-trang', 'Áo thun cotton 100%', 199000, TRUE)
        RETURNING id
    `, [parentId]);
    const activeProductId = prodRows[0].id;
    activeProductSlug = 'ao-thun-trang';

    const { rows: vRows } = await pool.query(`
        INSERT INTO product_variants (product_id, color_id, size_id, sku, price, stock)
        VALUES ($1, $2, $3, 'SKU-001', 199000, 50),
               ($1, $2, $3, 'SKU-002', 209000, 30)
        RETURNING id
    `, [activeProductId, whiteId, sId]);
    variantId = vRows[0].id;

    await pool.query(`
        INSERT INTO product_images (product_id, url, is_primary, sort_order)
        VALUES ($1, 'https://example.com/img1.jpg', TRUE, 1)
    `, [activeProductId]);

    // Inactive product
    await pool.query(`
        INSERT INTO products (category_id, name, slug, base_price, is_active)
        VALUES ($1, 'Áo tàng hình', 'ao-tang-hinh', 299000, FALSE)
    `, [parentId]);
});

afterAll(async () => {
    await pool.end();
});

// ── Categories ────────────────────────────────────────────────────────────────

describe('GET /api/v1/catalog/categories', () => {
    it('returns array with parent and child categories', async () => {
        const res = await request(app).get('/api/v1/catalog/categories');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(2);

        const parent = res.body.data.find(c => c.slug === 'ao');
        const child = res.body.data.find(c => c.slug === 'ao-thun');

        expect(parent).toBeDefined();
        expect(parent.depth).toBe(0);
        expect(child).toBeDefined();
        expect(child.depth).toBe(1);
        expect(child.parentId).toBe(parent.id);
    });
});

// ── Product listing ───────────────────────────────────────────────────────────

describe('GET /api/v1/catalog/products', () => {
    it('returns only active products', async () => {
        const res = await request(app).get('/api/v1/catalog/products');

        expect(res.status).toBe(200);
        const slugs = res.body.data.map(p => p.slug);
        expect(slugs).toContain('ao-thun-trang');
        expect(slugs).not.toContain('ao-tang-hinh'); // inactive
    });

    it('filters by category slug', async () => {
        const res = await request(app)
            .get('/api/v1/catalog/products')
            .query({ category: 'ao' });

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('full-text search returns matching product', async () => {
        const res = await request(app)
            .get('/api/v1/catalog/products')
            .query({ search: 'áo thun' });

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        expect(res.body.data[0].slug).toBe('ao-thun-trang');
    });

    it('pagination meta has correct total', async () => {
        const res = await request(app)
            .get('/api/v1/catalog/products')
            .query({ page: 1, limit: 1 });

        expect(res.status).toBe(200);
        expect(res.body.meta.page).toBe(1);
        expect(res.body.meta.limit).toBe(1);
        expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
        expect(res.body.data.length).toBe(1);
    });
});

// ── Product detail ────────────────────────────────────────────────────────────

describe('GET /api/v1/catalog/products/:slug', () => {
    it('returns product detail with variants and images arrays', async () => {
        const res = await request(app)
            .get(`/api/v1/catalog/products/${activeProductSlug}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('slug', activeProductSlug);
        expect(Array.isArray(res.body.data.variants)).toBe(true);
        expect(res.body.data.variants.length).toBeGreaterThanOrEqual(1);
        expect(Array.isArray(res.body.data.images)).toBe(true);
        expect(res.body.data.images.length).toBeGreaterThanOrEqual(1);
    });

    it('404 NOT_FOUND for non-existent slug', async () => {
        const res = await request(app)
            .get('/api/v1/catalog/products/non-existent-slug');

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });
});

// ── Admin: create product ─────────────────────────────────────────────────────

describe('POST /api/v1/catalog/products', () => {
    it('201 product created with admin token', async () => {
        const res = await request(app)
            .post('/api/v1/catalog/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Áo khoác mới', basePrice: 450000, categoryId: 1 });

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveProperty('slug');
        expect(res.body.data).toHaveProperty('name', 'Áo khoác mới');
    });

    it('403 FORBIDDEN with customer token', async () => {
        const res = await request(app)
            .post('/api/v1/catalog/products')
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ name: 'Sneaky product', basePrice: 100000, categoryId: 1 });

        expect(res.status).toBe(403);
    });

    it('400 when basePrice is missing', async () => {
        const res = await request(app)
            .post('/api/v1/catalog/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'No price product', categoryId: 1 });

        expect(res.status).toBe(400);
    });
});

// ── Admin: stock adjustment ───────────────────────────────────────────────────

describe('PATCH /api/v1/catalog/variants/:id/stock', () => {
    it('delta=+10 increases stock_qty', async () => {
        const res = await request(app)
            .patch(`/api/v1/catalog/variants/${variantId}/stock`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ delta: 10 });

        expect(res.status).toBe(200);
        expect(res.body.data.stock).toBe(60); // 50 + 10
    });

    it('delta=-9999 → 409 would go negative', async () => {
        const res = await request(app)
            .patch(`/api/v1/catalog/variants/${variantId}/stock`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ delta: -9999 });

        expect(res.status).toBe(409);
    });
});
