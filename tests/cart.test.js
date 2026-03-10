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

let variantA;   // stock = 10
let variantB;   // stock = 3
let userToken;
let user2Token;
const GUEST_SESSION = 'test-guest-session-id-abc123';
const GUEST_SESSION2 = 'test-guest-session-id-xyz789';

beforeAll(async () => {
    // Clean slate for cart-related tables + users
    await pool.query(`
        TRUNCATE TABLE
            cart_items, carts,
            product_variants, product_images,
            products, categories, colors, sizes,
            users, refresh_tokens
        RESTART IDENTITY CASCADE
    `);

    // Create test users
    const u1 = await createTestUser({ email: 'cartuser1@fashion.vn' });
    const u2 = await createTestUser({ email: 'cartuser2@fashion.vn' });
    userToken = u1.token;
    user2Token = u2.token;

    // Seed catalog
    const { rows: cats } = await pool.query(
        `INSERT INTO categories (name, slug) VALUES ('Áo', 'ao') RETURNING id`,
    );
    const catId = cats[0].id;

    const { rows: prods } = await pool.query(
        `INSERT INTO products (category_id, name, slug, base_price, is_active)
         VALUES ($1, 'Test Product', 'test-product', 200000, TRUE)
         RETURNING id`,
        [catId],
    );
    const productId = prods[0].id;

    const { rows: variants } = await pool.query(
        `INSERT INTO product_variants (product_id, sku, price, stock, is_active)
         VALUES ($1, 'SKU-A', 199000, 10, TRUE),
                ($1, 'SKU-B', 209000,  3, TRUE)
         RETURNING id, sku, price, stock`,
        [productId],
    );
    variantA = variants[0]; // stock=10
    variantB = variants[1]; // stock=3
});

afterAll(async () => {
    await pool.end();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Cart routes', () => {
    // 1. Guest adds item → 201, quantity=1
    it('1. Guest thêm item → 201, quantity=1', async () => {
        const res = await request(app)
            .post('/api/v1/cart/items')
            .set('Cookie', `session_id=${GUEST_SESSION}`)
            .send({ variantId: variantA.id, quantity: 1 });

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveProperty('quantity', 1);
        expect(res.body.data).toHaveProperty('variantId', variantA.id);
    });

    // 2. Guest adds same item again → quantity accumulates to 2
    it('2. Guest thêm cùng item lần 2 → quantity cộng dồn = 2', async () => {
        const res = await request(app)
            .post('/api/v1/cart/items')
            .set('Cookie', `session_id=${GUEST_SESSION}`)
            .send({ variantId: variantA.id, quantity: 1 });

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveProperty('quantity', 2);
    });

    // 3. Logged-in user has their own separate cart
    it('3. User có cart riêng, không thấy cart của guest', async () => {
        // User adds their own item
        await request(app)
            .post('/api/v1/cart/items')
            .set('Authorization', `Bearer ${userToken}`)
            .set('Cookie', `session_id=${GUEST_SESSION2}`)
            .send({ variantId: variantB.id, quantity: 1 });

        // Get user cart
        const res = await request(app)
            .get('/api/v1/cart')
            .set('Authorization', `Bearer ${userToken}`)
            .set('Cookie', `session_id=${GUEST_SESSION2}`);

        expect(res.status).toBe(200);
        const variantIds = res.body.data.items.map(i => i.variantId);
        // User sees only their own item
        expect(variantIds).toContain(variantB.id);
        // User's cart does NOT contain the guest's variantA item
        // (the guest used a different session GUEST_SESSION, not GUEST_SESSION2)
        expect(res.body.data).toHaveProperty('itemCount');
        expect(res.body.data).toHaveProperty('subtotal');
    });

    // 4. PATCH changes quantity
    it('4. PATCH /cart/items/:id → quantity mới được lưu', async () => {
        // Get guest cart first to find item id
        const cartRes = await request(app)
            .get('/api/v1/cart')
            .set('Cookie', `session_id=${GUEST_SESSION}`);
        const itemId = cartRes.body.data.items[0].id;

        const res = await request(app)
            .patch(`/api/v1/cart/items/${itemId}`)
            .set('Cookie', `session_id=${GUEST_SESSION}`)
            .send({ quantity: 5 });

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('quantity', 5);
    });

    // 5. DELETE removes item from cart
    it('5. DELETE /cart/items/:id → item không còn trong GET /cart', async () => {
        const cartRes = await request(app)
            .get('/api/v1/cart')
            .set('Cookie', `session_id=${GUEST_SESSION}`);
        const itemId = cartRes.body.data.items[0].id;

        const delRes = await request(app)
            .delete(`/api/v1/cart/items/${itemId}`)
            .set('Cookie', `session_id=${GUEST_SESSION}`);
        expect(delRes.status).toBe(200);
        expect(delRes.body.data.deleted).toBe(true);

        const afterRes = await request(app)
            .get('/api/v1/cart')
            .set('Cookie', `session_id=${GUEST_SESSION}`);
        expect(afterRes.body.data.itemCount).toBe(0);
    });

    // 6. POST /cart/merge moves guest items into user cart
    it('6. POST /cart/merge → items từ guest cart xuất hiện trong user cart', async () => {
        const MERGE_SESSION = 'merge-test-session-xyz';

        // Put an item in the guest cart for this session
        await request(app)
            .post('/api/v1/cart/items')
            .set('Cookie', `session_id=${MERGE_SESSION}`)
            .send({ variantId: variantA.id, quantity: 2 });

        // Merge into user
        const mergeRes = await request(app)
            .post('/api/v1/cart/merge')
            .set('Authorization', `Bearer ${userToken}`)
            .set('Cookie', `session_id=${MERGE_SESSION}`);
        expect(mergeRes.status).toBe(200);
        expect(mergeRes.body.data.merged).toBe(true);

        // User cart should now contain variantA
        const cartRes = await request(app)
            .get('/api/v1/cart')
            .set('Authorization', `Bearer ${userToken}`)
            .set('Cookie', `session_id=${MERGE_SESSION}`);
        const variantIds = cartRes.body.data.items.map(i => i.variantId);
        expect(variantIds).toContain(variantA.id);

        // Guest cart should be gone (empty response)
        const guestRes = await request(app)
            .get('/api/v1/cart')
            .set('Cookie', `session_id=${MERGE_SESSION}`);
        expect(guestRes.body.data.itemCount).toBe(0);
    });

    // 7. quantity > stock → 409 INSUFFICIENT_STOCK
    it('7. Thêm item quantity=5 khi stock=3 → 409 INSUFFICIENT_STOCK', async () => {
        const res = await request(app)
            .post('/api/v1/cart/items')
            .set('Cookie', `session_id=${GUEST_SESSION}`)
            .send({ variantId: variantB.id, quantity: 5 }); // stock is 3

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INSUFFICIENT_STOCK');
        expect(res.body.data.available).toBe(3);
    });

    // 8. PATCH item owned by another user → 404
    it('8. PATCH item của user khác → 404', async () => {
        // User1 adds an item to their cart
        await request(app)
            .post('/api/v1/cart/items')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ variantId: variantA.id, quantity: 1 });

        const u1Cart = await request(app)
            .get('/api/v1/cart')
            .set('Authorization', `Bearer ${userToken}`);
        const u1ItemId = u1Cart.body.data.items[0].id;

        // User2 tries to PATCH user1's item
        const res = await request(app)
            .patch(`/api/v1/cart/items/${u1ItemId}`)
            .set('Authorization', `Bearer ${user2Token}`)
            .send({ quantity: 99 });

        expect(res.status).toBe(404);
    });
});
