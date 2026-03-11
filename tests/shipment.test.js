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

describe('Shipments Feature', () => {
    let userToken;
    let user2Token;
    let adminToken;
    let userId;
    let user2Id;
    let adminId;
    
    let orderId;
    let shipmentId;

    beforeAll(async () => {
        // TRUNCATE all relevant tables CASCADE
        await pool.query(`
            TRUNCATE shipments, order_status_log, order_items, payments, orders,
                     cart_items, carts, product_variants, product_images, products,
                     categories, addresses, reviews CASCADE
        `);

        // Create Users & Admin
        const { rows: uRows } = await pool.query(`
            INSERT INTO users (email, password_hash, full_name, phone, role)
            VALUES 
                ('shiptester1@example.com', 'hashed', 'Tester One', '0111', 'customer'),
                ('shiptester2@example.com', 'hashed', 'Tester Two', '0222', 'customer'),
                ('adminship@example.com', 'hashed', 'Admin', '0000', 'admin')
            RETURNING id
        `);
        userId = uRows[0].id;
        user2Id = uRows[1].id;
        adminId = uRows[2].id;
        
        userToken = generateToken({ id: userId, role: 'customer' });
        user2Token = generateToken({ id: user2Id, role: 'customer' });
        adminToken = generateToken({ id: adminId, role: 'admin' });

        await pool.query(`INSERT INTO carts (user_id) VALUES ($1), ($2)`, [userId, user2Id]);

        // Helper: seedPendingOrder
        const seedPendingOrder = async (token) => {
            const { rows: cRows } = await pool.query(`INSERT INTO categories (name, slug) VALUES ('ShipCat', 'ship-cat') RETURNING id`);
            const { rows: pRows } = await pool.query(`
                INSERT INTO products (category_id, name, slug, base_price)
                VALUES ($1, 'Test Product Ship', 'test-product-ship', 300000)
                RETURNING id
            `, [cRows[0].id]);
            const { rows: vRows } = await pool.query(`
                INSERT INTO product_variants (product_id, sku, price, stock)
                VALUES ($1, 'SKU-SHIP-1', 300000, 10)
                RETURNING id
            `, [pRows[0].id]);
            const variantId = vRows[0].id;

            const { rows: aRows } = await pool.query(`
                INSERT INTO addresses (user_id, full_name, phone, address, city)
                VALUES ($1, 'Name', 'Phone', 'Addr', 'City')
                RETURNING id
            `, [userId]);
            const addressId = aRows[0].id;

            await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, quantity: 1 });
            const oRes = await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${token}`).send({ addressId, method: 'cod' });
            return oRes.body.data.orderId;
        };

        orderId = await seedPendingOrder(userToken);
    });

    afterAll(async () => {
        await pool.query(`
            TRUNCATE shipments, order_status_log, order_items, payments, orders,
                     cart_items, carts, product_variants, product_images, products,
                     categories, addresses, reviews CASCADE
        `);
        await pool.query(`DELETE FROM users WHERE email IN ('shiptester1@example.com', 'shiptester2@example.com', 'adminship@example.com')`);
    });

    it('4. GET /orders/:id/shipment when no shipment (new order) -> 404, code=SHIPMENT_NOT_FOUND', async () => {
        const res = await request(app)
            .get(`/api/v1/orders/${orderId}/shipment`)
            .set('Authorization', `Bearer ${userToken}`);
            
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('SHIPMENT_NOT_FOUND');
    });

    it('1. POST /admin/orders/:id/shipment (admin token) -> 201, order becomes shipped', async () => {
        const res = await request(app)
            .post(`/api/v1/admin/orders/${orderId}/shipment`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ carrier: 'GHN', trackingNumber: 'GHN123456' });

        expect(res.status).toBe(201);
        expect(res.body.data.carrier).toBe('GHN');
        expect(res.body.data.tracking_number).toBe('GHN123456');
        
        shipmentId = res.body.data.id;

        const orderCheck = await pool.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
        expect(orderCheck.rows[0].status).toBe('shipped');
    });

    it('2. GET /orders/:id/shipment (owner user token) -> 200, status=pending initially', async () => {
        const res = await request(app)
            .get(`/api/v1/orders/${orderId}/shipment`)
            .set('Authorization', `Bearer ${userToken}`);
            
        expect(res.status).toBe(200);
        expect(res.body.data.carrier).toBe('GHN');
        expect(res.body.data.tracking_number).toBe('GHN123456');
        expect(res.body.data.status).toBe('pending');
    });

    it('3. PATCH /admin/shipments/:id/status -> delivered clears delivered_at and sets order status', async () => {
        const res = await request(app)
            .patch(`/api/v1/admin/shipments/${shipmentId}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status: 'delivered' });
            
        expect(res.status).toBe(200);
        expect(res.body.data.delivered_at).not.toBeNull();

        const orderCheck = await pool.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
        expect(orderCheck.rows[0].status).toBe('delivered');
    });

    it('5. GET /orders/:id/shipment using wrong user token -> 404, code=ORDER_NOT_FOUND', async () => {
        const res = await request(app)
            .get(`/api/v1/orders/${orderId}/shipment`)
            .set('Authorization', `Bearer ${user2Token}`);
            
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ORDER_NOT_FOUND');
    });
});
