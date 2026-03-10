/**
 * Order service — business logic for checkout flow.
 */
import { getCartWithItems } from '../queries/cart.queries.js';
import { createOrderWithItems } from '../queries/order.queries.js';
import { getPaymentUrl } from './payment.service.js';

/**
 * Validates cart stock. Throws 409 OUT_OF_STOCK if any item exceeds available stock.
 */
function validateCartStock(items) {
    const outOfStock = items
        .filter(item => item.quantity > Number(item.stock))
        .map(item => ({
            variantId: item.variantId,
            requested: item.quantity,
            available: Number(item.stock),
        }));

    if (outOfStock.length > 0) {
        const err = new Error('Some items are out of stock');
        err.code = 'OUT_OF_STOCK';
        err.status = 409;
        err.data = outOfStock;
        throw err;
    }
}

/**
 * Process checkout for an authenticated user.
 *
 * @param {import('pg').Pool} pool
 * @param {{ userId: number, addressId: number|string, method: string }} opts
 * @returns {Promise<{ orderId, orderNo, subtotal, shippingFee, total, paymentUrl? }>}
 */
export async function checkout(pool, { userId, addressId, method }) {
    // 1. Validate address ownership
    const { rows: addrRows } = await pool.query(
        `SELECT id, full_name, phone, address, city FROM addresses WHERE id = $1 AND user_id = $2`,
        [addressId, userId],
    );
    if (!addrRows[0]) {
        const err = new Error('Address not found or does not belong to this user');
        err.code = 'ADDRESS_NOT_FOUND';
        err.status = 400;
        throw err;
    }
    const addr = addrRows[0];

    // 2. Fetch cart items
    const cartItems = await getCartWithItems(pool, { userId, sessionId: null });
    if (!cartItems.length) {
        const err = new Error('Cart is empty');
        err.code = 'EMPTY_CART';
        err.status = 400;
        throw err;
    }

    // 3. Validate stock
    validateCartStock(cartItems);

    // 4. Calculate totals
    const subtotal = cartItems.reduce(
        (sum, item) => sum + Number(item.priceAt) * item.quantity,
        0,
    );
    const shippingFee = subtotal >= 500000 ? 0 : 30000;
    const total = subtotal + shippingFee;

    // 5. Build items snapshot
    const items = cartItems.map(item => ({
        variantId: item.variantId,
        productName: item.productName,
        colorName: item.colorName ?? null,
        sizeLabel: item.sizeLabel ?? null,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: Number(item.priceAt),
        totalPrice: Number(item.priceAt) * item.quantity,
    }));

    // 6. Transaction
    const client = await pool.connect();
    let result;
    try {
        await client.query('BEGIN');
        result = await createOrderWithItems(client, {
            userId,
            addressId: addr.id,
            shipName: addr.full_name,
            shipPhone: addr.phone,
            shipAddress: addr.address,
            shipCity: addr.city ?? null,
            subtotal,
            shippingFee,
            total,
            items,
            method,
        });
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    // 7. Build response
    const response = {
        orderId: result.orderId,
        orderNo: result.orderNo,
        subtotal,
        shippingFee,
        total,
    };

    if (method !== 'cod') {
        response.paymentUrl = getPaymentUrl({ orderNo: result.orderNo });
    }

    return response;
}
