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

describe('Loyalty Points Feature', () => {
    let userToken;
    let adminToken;
    let userId;
    let adminId;
    let addressId;
    let variantId;

    beforeAll(async () => {
        await pool.query(`
            TRUNCATE loyalty_transactions, loyalty_accounts,
                     order_status_log, shipments, reviews,
                     order_items, payments, orders,
                     cart_items, carts,
                     product_variants, product_images, products,
                     categories, addresses CASCADE
        `);

        // Create Users
        const { rows: uRows } = await pool.query(`
            INSERT INTO users (email, password_hash, full_name, phone, role)
            VALUES 
                ('loytester@example.com', 'hashed', 'Loyalty User', '0123', 'customer'),
                ('loyatadmin@example.com', 'hashed', 'Admin', '0999', 'admin')
            RETURNING id
        `);
        userId = uRows[0].id;
        adminId = uRows[1].id;

        userToken = generateToken({ id: userId, role: 'customer' });
        adminToken = generateToken({ id: adminId, role: 'admin' });

        await pool.query(`INSERT INTO carts (user_id) VALUES ($1), ($2)`, [userId, adminId]);

        // Seed product
        const { rows: cRows } = await pool.query(`INSERT INTO categories (name, slug) VALUES ('LoyCat', 'loy-cat') RETURNING id`);
        const { rows: pRows } = await pool.query(`
            INSERT INTO products (category_id, name, slug, base_price)
            VALUES ($1, 'Test Product Loy', 'test-product-loy', 300000)
            RETURNING id
        `, [cRows[0].id]);
        const { rows: vRows } = await pool.query(`
            INSERT INTO product_variants (product_id, sku, price, stock)
            VALUES ($1, 'SKU-LOY-1', 300000, 100)
            RETURNING id
        `, [pRows[0].id]);
        variantId = vRows[0].id;

        // Seed Address
        const { rows: aRows } = await pool.query(`
            INSERT INTO addresses (user_id, full_name, phone, address, city)
            VALUES ($1, 'Name', 'Phone', 'Addr', 'City')
            RETURNING id
        `, [userId]);
        addressId = aRows[0].id;
    });

    afterAll(async () => {
        await pool.query(`
            TRUNCATE loyalty_transactions, loyalty_accounts,
                     order_status_log, shipments, reviews,
                     order_items, payments, orders,
                     cart_items, carts,
                     product_variants, product_images, products,
                     categories, addresses CASCADE
        `);
        await pool.query(`DELETE FROM users WHERE email IN ('loytester@example.com', 'loyatadmin@example.com')`);
    });

    // Helper to quickly place an order via the API 
    const placeOrder = async (qty = 1) => {
        // Add item
        await request(app)
            .post('/api/v1/cart/items')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ variantId, quantity: qty });
            
        // Checkout
        const oRes = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod' });
            
        return oRes.body.data.orderId;
    };

    let order1Id;

    it('1. GET /loyalty -> auto-creates account, balance=0, tier=bronze, recentTransactions=[]', async () => {
        const res = await request(app)
            .get('/api/v1/loyalty')
            .set('Authorization', `Bearer ${userToken}`);
            
        expect(res.status).toBe(200);
        expect(res.body.data.balance).toBe(0);
        expect(res.body.data.tier).toBe('bronze');
        expect(res.body.data.totalEarned).toBe(0);
        expect(res.body.data.recentTransactions).toEqual([]);
    });

    it('2. POST /admin/orders/:id/complete -> earns 33 points', async () => {
        order1Id = await placeOrder(1); // subtotal 300k + 30k ship = 330k total -> 33 pts

        const completeRes = await request(app)
            .post(`/api/v1/admin/orders/${order1Id}/complete`)
            .set('Authorization', `Bearer ${adminToken}`);
            
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.data.pointsEarned).toBe(33);

        const loyRes = await request(app)
            .get('/api/v1/loyalty')
            .set('Authorization', `Bearer ${userToken}`);
            
        expect(loyRes.body.data.balance).toBe(33);
        expect(loyRes.body.data.totalEarned).toBe(33);
        expect(loyRes.body.data.recentTransactions.length).toBe(1);
    });

    it('3. Tier automatically updates to silver on massive spend', async () => {
        const bigOrderId = await placeOrder(34); // subtotal 10.2M + 0 ship = 10.2M total -> 1020 pts
        
        const completeRes = await request(app)
            .post(`/api/v1/admin/orders/${bigOrderId}/complete`)
            .set('Authorization', `Bearer ${adminToken}`);
            
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.data.pointsEarned).toBe(1020);

        const loyRes = await request(app)
            .get('/api/v1/loyalty')
            .set('Authorization', `Bearer ${userToken}`);
            
        // 33 + 1020 = 1053 total earned -> silver threshold
        expect(loyRes.body.data.balance).toBe(1053);
        expect(loyRes.body.data.tier).toBe('silver');
    });

    it('4. Checkout with pointsToRedeem=10 applies 1000 VND discount natively', async () => {
        // Add item
        await request(app)
            .post('/api/v1/cart/items')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ variantId, quantity: 1 });
            
        // Checkout using 10 points
        const oRes = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', pointsToRedeem: 10 });
            
        expect(oRes.status).toBe(201);
        expect(oRes.body.data.pointsDiscount).toBe(1000);
        expect(oRes.body.data.pointsUsed).toBe(10);
        // math check: 300,000 + 30,000 = 330,000 sub - 1000 discount = 329,000 total
        expect(Number(oRes.body.data.total)).toBe(329000);

        // Verify balance decreased
        const loyRes = await request(app)
            .get('/api/v1/loyalty')
            .set('Authorization', `Bearer ${userToken}`);
            
        expect(loyRes.body.data.balance).toBe(1043); // 1053 - 10
        expect(loyRes.body.data.totalEarned).toBe(1053); // hasn't natively dropped
    });

    it('5. Checkout with pointsToRedeem > balance -> 400 INSUFFICIENT_POINTS', async () => {
        await request(app)
            .post('/api/v1/cart/items')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ variantId, quantity: 1 });
            
        const oRes = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', pointsToRedeem: 999999 });
            
        expect(oRes.status).toBe(400);
        expect(oRes.body.code).toBe('INSUFFICIENT_POINTS');
        expect(oRes.body.data).toHaveProperty('available');
    });

    it('6. POST /admin/orders/:id/complete twice (already completed) -> 409 ORDER_NOT_COMPLETABLE', async () => {
        const completeRes = await request(app)
            .post(`/api/v1/admin/orders/${order1Id}/complete`)
            .set('Authorization', `Bearer ${adminToken}`);
            
        expect(completeRes.status).toBe(409);
        expect(completeRes.body.code).toBe('ORDER_NOT_COMPLETABLE');
    });
});
