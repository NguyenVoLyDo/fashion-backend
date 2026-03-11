/**
 * Order service — business logic for checkout flow.
 */
import { getCartWithItems } from '../queries/cart.queries.js';
import { clearCart } from '../queries/cart.queries.js';
import { createOrderWithItems } from '../queries/order.queries.js';
import {
    findVoucherByCode,
    validateVoucher,
    calculateDiscount
} from '../queries/voucher.queries.js';
import {
    getOrCreateAccount,
    redeemPoints
} from '../queries/loyalty.queries.js';
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
 * @param {{ userId: number, addressId: number|string, method: string, note?: string, voucherCode?: string, pointsToRedeem?: number }} opts
 * @returns {Promise<{ orderId, orderNo, subtotal, shippingFee, total, paymentUrl?, pointsUsed?: number, pointsDiscount?: number }>}
 */
export async function checkout(pool, { userId, addressId, method, note, voucherCode, pointsToRedeem = 0 }) {
    // 1. Get cart items + lock variantss ownership
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

    let discountAmount = 0;
    let validVoucher = null;
    let freeShip = false;

    if (voucherCode) {
        validVoucher = await validateVoucher(pool, { code: voucherCode, subtotal });
        discountAmount = calculateDiscount(validVoucher, subtotal);
        if (validVoucher.type === 'free_ship') {
            freeShip = true;
        }
    }

    const shippingFee = (freeShip || subtotal >= 500000) ? 0 : 30000;

    // 2.3 Loyalty Points logic
    let pointsDiscount = 0;
    if (pointsToRedeem > 0) {
        const account = await getOrCreateAccount(pool, userId);
        if (account.points_balance < pointsToRedeem) {
            throw {
                code: 'INSUFFICIENT_POINTS',
                status: 400,
                error: 'Not enough loyalty points available',
                data: { available: account.points_balance, requested: pointsToRedeem }
            };
        }
        pointsDiscount = pointsToRedeem * 100; // Assuming 1 point = 100 currency units
    }

    // 2.4 Final total
    const total = Math.max(0, subtotal - discountAmount - pointsDiscount + shippingFee);

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

        if (pointsToRedeem > 0) {
            await redeemPoints(client, { userId, pointsToRedeem });
        }

        result = await createOrderWithItems(client, {
            userId,
            addressId: addr.id,
            shipName: addr.full_name,
            shipPhone: addr.phone,
            shipAddress: addr.address,
            shipCity: addr.city ?? null,
            subtotal,
            shippingFee,
            discountAmount,
            total,
            items,
            method,
            voucherId: validVoucher?.id,
            pointsUsed: pointsToRedeem,
            pointsDiscount,
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
        pointsUsed: pointsToRedeem,
        pointsDiscount,
    };

    if (method !== 'cod') {
        response.paymentUrl = getPaymentUrl({ orderNo: result.orderNo });
    }

    return response;
}
