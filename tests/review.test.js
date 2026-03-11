import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import pool from '../src/config/db.js';
import jwt from 'jsonwebtoken';

function generateToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-me', {
        expiresIn: '15m',
    });
}

describe('Reviews Feature', () => {
    let user1Token;
    let user2Token;
    let user1Id;
    let user2Id;
    let address1Id;
    
    let testProductId;
    let testProductSlug = 'test-product-review';
    let testVariantId;
    let order1Id;
    let review1Id;

    beforeAll(async () => {
        // TRUNCATE all relevant tables CASCADE
        await pool.query(`
            TRUNCATE reviews, order_items, payments, orders, cart_items, carts,
                     product_variants, product_images, products, categories,
                     addresses CASCADE
        `);

        // Create 2 users
        const { rows: uRows } = await pool.query(`
            INSERT INTO users (email, password_hash, full_name, phone)
            VALUES 
                ('reviewtester1@example.com', 'hashed', 'Tester One', '0111'),
                ('reviewtester2@example.com', 'hashed', 'Tester Two', '0222')
            RETURNING id
        `);
        user1Id = uRows[0].id;
        user2Id = uRows[1].id;
        user1Token = generateToken({ id: user1Id, role: 'customer' });
        user2Token = generateToken({ id: user2Id, role: 'customer' });

        // Seed Carts
        await pool.query(`INSERT INTO carts (user_id) VALUES ($1), ($2)`, [user1Id, user2Id]);

        // Helper: Seed product
        const seedProduct = async () => {
            const { rows: cRows } = await pool.query(`INSERT INTO categories (name, slug) VALUES ('RevCat', 'rev-cat') RETURNING id`);
            const { rows: pRows } = await pool.query(`
                INSERT INTO products (category_id, name, slug, base_price)
                VALUES ($1, 'Test Product Review', $2, 300000)
                RETURNING id
            `, [cRows[0].id, testProductSlug]);
            testProductId = pRows[0].id;

            const { rows: vRows } = await pool.query(`
                INSERT INTO product_variants (product_id, sku, price, stock)
                VALUES ($1, 'SKU-REV-1', 300000, 10)
                RETURNING id
            `, [testProductId]);
            testVariantId = vRows[0].id;
        };

        // Helper: Seed Address
        const seedAddress = async (uid) => {
            const { rows } = await pool.query(`
                INSERT INTO addresses (user_id, full_name, phone, address, city)
                VALUES ($1, 'Name', 'Phone', 'Addr', 'City')
                RETURNING id
            `, [uid]);
            return rows[0].id;
        };

        // Helper: Seed Completed Order
        const seedCompletedOrder = async (token, addrId, varId) => {
            await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId: varId, quantity: 1 });
            const oRes = await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${token}`).send({ addressId: addrId, method: 'cod' });
            const oid = oRes.body.data.orderId;
            await pool.query(`UPDATE orders SET status = 'completed' WHERE id = $1`, [oid]);
            return { orderId: oid, productId: testProductId };
        };

        await seedProduct();
        address1Id = await seedAddress(user1Id);
        const oData = await seedCompletedOrder(user1Token, address1Id, testVariantId);
        order1Id = oData.orderId;
    });

    afterAll(async () => {
        await pool.query(`
            TRUNCATE reviews, order_items, payments, orders, cart_items, carts,
                     product_variants, product_images, products, categories,
                     addresses CASCADE
        `);
        await pool.query(`DELETE FROM users WHERE email IN ('reviewtester1@example.com', 'reviewtester2@example.com')`);
    });

    it('1. GET /products/:slug/reviews when no reviews -> data=[], meta.total=0, meta.avgRating=null', async () => {
        const res = await request(app).get(`/api/v1/products/${testProductSlug}/reviews`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.meta.total).toBe(0);
        expect(res.body.meta.avgRating).toBe(null);
    });

    it('2. POST /products/:slug/reviews with valid orderId -> 201, is_verified=true, correct rating', async () => {
        const res = await request(app)
            .post(`/api/v1/products/${testProductSlug}/reviews`)
            .set('Authorization', `Bearer ${user1Token}`)
            .send({ rating: 4, title: 'Good', body: 'Nice product', orderId: order1Id });

        expect(res.status).toBe(201);
        expect(res.body.data.rating).toBe(4);
        expect(res.body.data.is_verified).toBe(true);
        review1Id = res.body.data.id;
    });

    it('3. GET /products/:slug/reviews after review created -> review in list, meta.avgRating correct', async () => {
        const res = await request(app).get(`/api/v1/products/${testProductSlug}/reviews`);
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].id).toBe(review1Id);
        expect(res.body.meta.total).toBe(1);
        // DB returns avgRating as string normally from numeric fields depending on driver, but our query transforms or rounds
        const avg = res.body.meta.avgRating;
        expect(Number(avg)).toBe(4);
    });

    it('4. GET /products/:slug (product detail) -> avg_rating and review_count are in response and correct', async () => {
        const res = await request(app).get(`/api/v1/products/${testProductSlug}`);
        expect(res.status).toBe(200);
        const p = res.body.data;
        // In PostgreSQL numeric aggregates might come back as strings, ensuring Number casting works
        expect(Number(p.avg_rating)).toBe(4);
        expect(Number(p.review_count)).toBe(1);
    });

    it('5. POST review again on same product + orderId -> 409, code=ALREADY_REVIEWED', async () => {
        const res = await request(app)
            .post(`/api/v1/products/${testProductSlug}/reviews`)
            .set('Authorization', `Bearer ${user1Token}`)
            .send({ rating: 5, orderId: order1Id });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('ALREADY_REVIEWED');
    });

    it('6. DELETE /reviews/:id using wrong user token -> 404, code=REVIEW_NOT_FOUND', async () => {
        // user2 tries to delete user1's review
        const res = await request(app)
            .delete(`/api/v1/reviews/${review1Id}`)
            .set('Authorization', `Bearer ${user2Token}`);

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('REVIEW_NOT_FOUND');
    });
});
