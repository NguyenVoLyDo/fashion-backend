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

async function createTestUser({ email, role = 'customer' }) {
    const hash = await bcrypt.hash('password123', 10);
    const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
         RETURNING id, email, role`,
        [email, hash, 'Test User', role],
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

let variantA;   // stock=10, price=300000
let variantB;   // stock=2,  price=200000
let userToken;
let user;
let user2Token;
let addressId;

async function seedProduct() {
    const { rows: cats } = await pool.query(
        `INSERT INTO categories (name, slug) VALUES ('Áo', 'ao-test') RETURNING id`,
    );
    const catId = cats[0].id;

    const { rows: prods } = await pool.query(
        `INSERT INTO products (category_id, name, slug, base_price, is_active)
         VALUES ($1, 'Test Product', 'test-product-order', 250000, TRUE)
         RETURNING id`,
        [catId],
    );
    const productId = prods[0].id;

    const { rows: variants } = await pool.query(
        `INSERT INTO product_variants (product_id, sku, price, stock, is_active)
         VALUES ($1, 'SKU-ORDER-A', 300000, 10, TRUE),
                ($1, 'SKU-ORDER-B', 200000,  2, TRUE)
         RETURNING id, sku, price, stock`,
        [productId],
    );
    variantA = variants[0]; // stock=10
    variantB = variants[1]; // stock=2
}

async function seedAddress(userId) {
    const { rows } = await pool.query(
        `INSERT INTO addresses (user_id, full_name, phone, address, city)
         VALUES ($1, 'Test User', '0901234567', '123 Test St', 'HCM')
         RETURNING id`,
        [userId],
    );
    return rows[0].id;
}

async function addItemToCart(userToken, variantId, qty) {
    return request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ variantId, quantity: qty });
}

beforeAll(async () => {
    // Clean slate
    await pool.query(`
        TRUNCATE TABLE
            order_status_log, order_items, payments, orders,
            cart_items, carts,
            product_variants, product_images,
            products, categories,
            addresses,
            users, refresh_tokens
        RESTART IDENTITY CASCADE
    `);

    // Create test users
    const u1 = await createTestUser({ email: 'orderuser1@fashion.vn' });
    const u2 = await createTestUser({ email: 'orderuser2@fashion.vn' });
    userToken = u1.token;
    user = u1.user;
    user2Token = u2.token;

    await seedProduct();
    addressId = await seedAddress(user.id);
});

afterAll(async () => {
    await pool.end();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Order routes', () => {

    // 1. Checkout COD subtotal < 500k → shippingFee=30000
    it('1. Checkout COD subtotal < 500k → shippingFee=30000, stock giảm, cart rỗng', async () => {
        // Add 1x variantA (300000 < 500000 threshold)
        await addItemToCart(userToken, variantA.id, 1);

        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod' });

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveProperty('orderId');
        expect(res.body.data).toHaveProperty('orderNo');
        expect(Number(res.body.data.shippingFee)).toBe(30000);
        expect(Number(res.body.data.total)).toBe(330000); // 300000 + 30000

        // Cart should be cleared
        const cartRes = await request(app)
            .get('/api/v1/cart')
            .set('Authorization', `Bearer ${userToken}`);
        expect(cartRes.body.data.itemCount).toBe(0);

        // Stock should have decreased
        const { rows: pvRows } = await pool.query(
            `SELECT stock FROM product_variants WHERE id = $1`,
            [variantA.id],
        );
        expect(pvRows[0].stock).toBe(9); // 10 - 1
    });

    // 2. Checkout COD subtotal >= 500k → shippingFee=0
    it('2. Checkout COD subtotal >= 500k → shippingFee=0', async () => {
        // Add 2x variantA (300000 × 2 = 600000 >= 500000)
        await addItemToCart(userToken, variantA.id, 2);

        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod' });

        expect(res.status).toBe(201);
        expect(Number(res.body.data.shippingFee)).toBe(0);
        expect(Number(res.body.data.total)).toBe(600000);
    });

    // 3. GET /orders → list with pagination meta
    it('3. GET /orders → trả về list với pagination meta', async () => {
        const res = await request(app)
            .get('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('meta');
        expect(res.body.meta).toHaveProperty('page');
        expect(res.body.meta).toHaveProperty('limit');
        expect(res.body.meta).toHaveProperty('total');
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    // 4. GET /orders/:id → items[] + payment object
    it('4. GET /orders/:id → có items[] và payment object', async () => {
        // Get first order id from list
        const listRes = await request(app)
            .get('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`);
        const orderId = listRes.body.data[0].id;

        const res = await request(app)
            .get(`/api/v1/orders/${orderId}`)
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.items)).toBe(true);
        expect(res.body.data.items.length).toBeGreaterThan(0);
        expect(res.body.data).toHaveProperty('payment');
        expect(res.body.data.payment).toHaveProperty('method', 'cod');
        expect(res.body.data.payment).toHaveProperty('status', 'pending');
    });

    // 5. POST /orders no addressId → 400
    it('5. POST /orders không có addressId → 400', async () => {
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ method: 'cod' });

        expect(res.status).toBe(400);
    });

    // 6. POST /orders with empty cart → 400 EMPTY_CART
    it('6. POST /orders cart rỗng → 400 EMPTY_CART', async () => {
        // Cart is cleared after checkouts above
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('EMPTY_CART');
    });

    // 7. POST /orders with variantB qty=5 (stock=2) → 409 OUT_OF_STOCK
    it('7. POST /orders variantB qty=5 (stock=2) → 409 OUT_OF_STOCK', async () => {
        // Insert directly into cart to bypass cart-level stock check
        // (simulates: item was in cart when stock was available, then stock depleted)
        await pool.query(`
            INSERT INTO cart_items (cart_id, variant_id, quantity, price_at)
            VALUES (
                (SELECT id FROM carts WHERE user_id = $1 LIMIT 1),
                $2, 5, $3
            )
            ON CONFLICT (cart_id, variant_id)
            DO UPDATE SET quantity = 5
        `, [user.id, variantB.id, variantB.price]);

        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod' });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('OUT_OF_STOCK');
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data[0]).toMatchObject({
            variantId: variantB.id,
            requested: 5,
            available: 2,
        });

        // Cart not cleared — cleanup for next tests
        await request(app)
            .delete('/api/v1/cart')
            .set('Authorization', `Bearer ${userToken}`);
    });

    // 8. GET /orders/:id of another user → 404
    it('8. GET /orders/:id của user khác → 404 ORDER_NOT_FOUND', async () => {
        // Get user1's first order id
        const listRes = await request(app)
            .get('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`);
        const orderId = listRes.body.data[0].id;

        // Try to access with user2's token
        const res = await request(app)
            .get(`/api/v1/orders/${orderId}`)
            .set('Authorization', `Bearer ${user2Token}`);

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ORDER_NOT_FOUND');
    });

    // 9. PATCH /orders/:id/cancel (pending) → status='cancelled'
    it('9. PATCH /orders/:id/cancel (status=pending) → status=\'cancelled\'', async () => {
        // Create a new order to cancel
        await addItemToCart(userToken, variantA.id, 1);
        const orderRes = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod' });
        const orderId = orderRes.body.data.orderId;

        const res = await request(app)
            .patch(`/api/v1/orders/${orderId}/cancel`)
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('cancelled');
    });

    // 10. PATCH /orders/:id/cancel (confirmed) → 409 CANNOT_CANCEL
    it('10. PATCH /orders/:id/cancel (status=confirmed) → 409 CANNOT_CANCEL', async () => {
        // Create an order and manually set it to 'confirmed'
        await addItemToCart(userToken, variantA.id, 1);
        const orderRes = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod' });
        const orderId = orderRes.body.data.orderId;

        // Move to confirmed status directly in DB
        await pool.query(
            `UPDATE orders SET status = 'confirmed' WHERE id = $1`,
            [orderId],
        );

        const res = await request(app)
            .patch(`/api/v1/orders/${orderId}/cancel`)
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('CANNOT_CANCEL');
    });
});
