import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import pool from '../src/config/db.js';
import jwt from 'jsonwebtoken';

function generateToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-me', {
        expiresIn: '15m',
    });
}

describe('Vouchers Feature', () => {
    let userToken;
    let userId;
    let addressId;
    let variantId;
    let voucherPercentCode = 'TESTPERCENT20';
    let voucherFixedCode = 'TESTFIXED50K';
    let voucherFreeShipCode = 'TESTFREESHIP';
    let voucherTwiceCode = 'TESTTWICE';

    beforeAll(async () => {
        // Clean up before starting
        await pool.query(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'vouchertest@example.com'))`);
        await pool.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'vouchertest@example.com'))`);
        await pool.query(`DELETE FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'vouchertest@example.com')`);
        await pool.query(`DELETE FROM users WHERE email = 'vouchertest@example.com'`);
        await pool.query(`DELETE FROM products WHERE slug = 'test-product-voucher'`);
        await pool.query(`DELETE FROM categories WHERE slug = 'test-cat-voucher'`);
        await pool.query(`DELETE FROM vouchers WHERE code LIKE 'TEST%'`);

        // Setup user
        const { rows: userRows } = await pool.query(`
            INSERT INTO users (email, password_hash, full_name, phone)
            VALUES ('vouchertest@example.com', 'hashed', 'Voucher Test User', '0123456789')
            RETURNING id
        `);
        userId = userRows[0].id;
        userToken = generateToken({ id: userId, role: 'customer' });

        // Setup cart for user
        await pool.query(`INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);

        // Setup address
        const { rows: addrRows } = await pool.query(`
            INSERT INTO addresses (user_id, full_name, phone, address, city)
            VALUES ($1, 'Voucher Test User', '0123456789', '123 Test St', 'Test City')
            RETURNING id
        `, [userId]);
        addressId = addrRows[0].id;

        // Setup category, product and variant
        const { rows: catRows } = await pool.query(`
            INSERT INTO categories (name, slug)
            VALUES ('Test Category', 'test-cat-voucher')
            RETURNING id
        `);
        const { rows: prodRows } = await pool.query(`
            INSERT INTO products (category_id, name, slug, base_price)
            VALUES ($1, 'Test Product', 'test-product-voucher', 300000)
            RETURNING id
        `, [catRows[0].id]);
        const { rows: varRows } = await pool.query(`
            INSERT INTO product_variants (product_id, sku, price, stock)
            VALUES ($1, 'SKU-VOUCHER', 300000, 20)
            RETURNING id
        `, [prodRows[0].id]);
        variantId = varRows[0].id;

        // Setup Vouchers
        await pool.query(`
            INSERT INTO vouchers (code, type, value, usage_limit, min_order_value)
            VALUES ($1, 'percent', 20, null, 100000)
        `, [voucherPercentCode]);

        await pool.query(`
            INSERT INTO vouchers (code, type, value, usage_limit, min_order_value)
            VALUES ($1, 'fixed', 50000, null, 200000)
        `, [voucherFixedCode]);

        await pool.query(`
            INSERT INTO vouchers (code, type, value, usage_limit, min_order_value)
            VALUES ($1, 'free_ship', 0, null, 0)
        `, [voucherFreeShipCode]);

        await pool.query(`
            INSERT INTO vouchers (code, type, value, usage_limit, min_order_value)
            VALUES ($1, 'percent', 10, null, 0)
        `, [voucherTwiceCode]);

        await pool.query(`
            INSERT INTO vouchers (code, type, value, usage_limit, valid_until)
            VALUES ('TESTEXPIRED', 'percent', 10, null, NOW() - INTERVAL '1 day')
        `);

        await pool.query(`
            INSERT INTO vouchers (code, type, value, usage_limit, min_order_value)
            VALUES ('TESTMINORDER', 'fixed', 20000, null, 500000)
        `);

        await pool.query(`
            INSERT INTO vouchers (code, type, value, usage_limit, used_count)
            VALUES ('TESTEXHAUSTED', 'fixed', 10000, 1, 1)
        `);
    });

    afterAll(async () => {
        // Clean up
        await pool.query(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'vouchertest@example.com'))`);
        await pool.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'vouchertest@example.com'))`);
        await pool.query(`DELETE FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'vouchertest@example.com')`);
        await pool.query(`DELETE FROM users WHERE email = 'vouchertest@example.com'`);
        await pool.query(`DELETE FROM products WHERE slug = 'test-product-voucher'`);
        await pool.query(`DELETE FROM categories WHERE slug = 'test-cat-voucher'`);
        await pool.query(`DELETE FROM vouchers WHERE code LIKE 'TEST%'`);
    });

    beforeEach(async () => {
        // Clear cart items
        await pool.query(`
            DELETE FROM cart_items 
            WHERE cart_id = (SELECT id FROM carts WHERE user_id = $1 LIMIT 1)
        `, [userId]);

        // Add 1 item (price 300000) to cart
        await request(app)
            .post('/api/v1/cart/items')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ variantId, quantity: 1 });
    });

    it('1. Checkout with voucher percent 20% -> discountAmount = 60000', async () => {
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: voucherPercentCode });
        
        expect(res.status).toBe(201);
        const { rows } = await pool.query('SELECT discount_amount FROM orders WHERE id = $1', [res.body.data.orderId]);
        expect(Number(rows[0].discount_amount)).toBe(60000);
    });

    it('2. Checkout with voucher fixed 50000 -> discountAmount = 50000', async () => {
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: voucherFixedCode });
        
        expect(res.status).toBe(201);
        const { rows } = await pool.query('SELECT discount_amount FROM orders WHERE id = $1', [res.body.data.orderId]);
        expect(Number(rows[0].discount_amount)).toBe(50000);
    });

    it('3. Checkout with voucher free_ship -> shippingFee = 0', async () => {
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: voucherFreeShipCode });
        
        expect(res.status).toBe(201);
        expect(res.body.data.shippingFee).toBe(0);
        const { rows } = await pool.query('SELECT shipping_fee, discount_amount FROM orders WHERE id = $1', [res.body.data.orderId]);
        expect(Number(rows[0].shipping_fee)).toBe(0);
        expect(Number(rows[0].discount_amount)).toBe(0);
    });

    it('4. Use voucher twice -> used_count increases each time', async () => {
        // Initial usage query
        const getUsedCount = async () => {
            const { rows } = await pool.query(`SELECT used_count FROM vouchers WHERE code = $1`, [voucherTwiceCode]);
            return rows[0].used_count;
        };

        const initial = await getUsedCount();

        // First checkout
        await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: voucherTwiceCode });
        
        expect(await getUsedCount()).toBe(initial + 1);

        // Add to cart again
        await pool.query(`
            DELETE FROM cart_items 
            WHERE cart_id = (SELECT id FROM carts WHERE user_id = $1 LIMIT 1)
        `, [userId]);
        await request(app)
            .post('/api/v1/cart/items')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ variantId, quantity: 1 });

        // Second checkout
        await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: voucherTwiceCode });
            
        expect(await getUsedCount()).toBe(initial + 2);
    });

    it('5. Voucher expired (valid_until in past) -> 400 VOUCHER_EXPIRED', async () => {
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: 'TESTEXPIRED' });
        
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VOUCHER_EXPIRED');
    });

    it('6. Subtotal < min_order_value -> 400 VOUCHER_MIN_NOT_MET, data.minRequired present', async () => {
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: 'TESTMINORDER' });
        
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VOUCHER_MIN_NOT_MET');
        expect(res.body.data.minRequired).toBe(500000);
    });

    it('7. usage_limit=1, already used -> 400 VOUCHER_EXHAUSTED', async () => {
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: 'TESTEXHAUSTED' });
        
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VOUCHER_EXHAUSTED');
    });

    it('8. Code does not exist -> 400 VOUCHER_NOT_FOUND', async () => {
        const res = await request(app)
            .post('/api/v1/orders')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ addressId, method: 'cod', voucherCode: 'DOESNOTEXIST' });
        
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VOUCHER_NOT_FOUND');
    });
});
