import { Router } from 'express';
import { body } from 'express-validator';
import { validationResult } from 'express-validator';

import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import optionalAuth from '../middleware/optional-auth.js';
import pool from '../config/db.js';
import {
    getOrCreateCart,
    getCartWithItems,
    getPriceForVariant,
    upsertCartItem,
    updateCartItemQty,
    deleteCartItem,
    clearCart,
    mergeGuestCart,
} from '../queries/cart.queries.js';

const router = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

function validate(req) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const err = new Error('Validation failed');
        err.code = 'BAD_REQUEST';
        err.status = 400;
        err.details = errors.array();
        throw err;
    }
}

/** Resolve cart identity from request (user id or session id). */
function cartIdentity(req) {
    return {
        userId: req.user?.id ?? null,
        sessionId: req.sessionId ?? null,
    };
}

/** Compute subtotal and item count from items array. */
function cartSummary(items) {
    const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
    const subtotal = items.reduce((sum, i) => sum + Number(i.priceAt) * i.quantity, 0);
    return { itemCount, subtotal: Math.round(subtotal * 100) / 100 };
}

// ── GET /cart ─────────────────────────────────────────────────────────────────

router.get(
    '/',
    optionalAuth,
    asyncHandler(async (req, res) => {
        const items = await getCartWithItems(pool, cartIdentity(req));
        const { itemCount, subtotal } = cartSummary(items);
        return res.status(200).json({ data: { items, itemCount, subtotal } });
    }),
);

// ── POST /cart/items ──────────────────────────────────────────────────────────

router.post(
    '/items',
    optionalAuth,
    body('variantId').notEmpty().withMessage('variantId is required'),
    body('quantity').optional().isInt({ min: 1 }).toInt().withMessage('quantity must be a positive integer'),
    asyncHandler(async (req, res) => {
        validate(req);

        const variantId = req.body.variantId;
        const quantity = req.body.quantity ?? 1;

        // Verify variant exists and check stock
        const variant = await getPriceForVariant(pool, variantId);
        if (!variant) {
            return res.status(404).json({ error: 'Variant not found', code: 'VARIANT_NOT_FOUND' });
        }
        if (quantity > variant.stock) {
            return res.status(409).json({
                error: 'Insufficient stock',
                code: 'INSUFFICIENT_STOCK',
                data: { available: variant.stock },
            });
        }

        const cartId = await getOrCreateCart(pool, cartIdentity(req));
        const item = await upsertCartItem(pool, {
            cartId,
            variantId,
            quantity,
            priceAt: variant.price,
        });

        return res.status(201).json({ data: item });
    }),
);

// ── PATCH /cart/items/:id ─────────────────────────────────────────────────────

router.patch(
    '/items/:id',
    optionalAuth,
    body('quantity').isInt({ min: 1 }).toInt().withMessage('quantity must be a positive integer'),
    asyncHandler(async (req, res) => {
        validate(req);

        const { userId, sessionId } = cartIdentity(req);

        // Resolve cart id for ownership check
        const { rows } = await pool.query(
            userId
                ? `SELECT id FROM carts WHERE user_id = $1 LIMIT 1`
                : `SELECT id FROM carts WHERE session_id = $1 LIMIT 1`,
            [userId ?? sessionId],
        );

        if (!rows[0]) {
            return res.status(404).json({ error: 'Cart item not found', code: 'NOT_FOUND' });
        }

        const item = await updateCartItemQty(pool, {
            itemId: req.params.id,
            cartId: rows[0].id,
            quantity: req.body.quantity,
        });
        if (!item) {
            return res.status(404).json({ error: 'Cart item not found', code: 'NOT_FOUND' });
        }

        return res.status(200).json({ data: item });
    }),
);

// ── DELETE /cart/items/:id ────────────────────────────────────────────────────

router.delete(
    '/items/:id',
    optionalAuth,
    asyncHandler(async (req, res) => {
        const { userId, sessionId } = cartIdentity(req);
        const { rows } = await pool.query(
            userId
                ? `SELECT id FROM carts WHERE user_id = $1 LIMIT 1`
                : `SELECT id FROM carts WHERE session_id = $1 LIMIT 1`,
            [userId ?? sessionId],
        );

        if (!rows[0]) {
            return res.status(404).json({ error: 'Cart item not found', code: 'NOT_FOUND' });
        }

        const deleted = await deleteCartItem(pool, {
            itemId: req.params.id,
            cartId: rows[0].id,
        });
        if (!deleted) {
            return res.status(404).json({ error: 'Cart item not found', code: 'NOT_FOUND' });
        }

        return res.status(200).json({ data: { deleted: true } });
    }),
);

// ── DELETE /cart ──────────────────────────────────────────────────────────────

router.delete(
    '/',
    optionalAuth,
    asyncHandler(async (req, res) => {
        const { userId, sessionId } = cartIdentity(req);
        const { rows } = await pool.query(
            userId
                ? `SELECT id FROM carts WHERE user_id = $1 LIMIT 1`
                : `SELECT id FROM carts WHERE session_id = $1 LIMIT 1`,
            [userId ?? sessionId],
        );
        if (rows[0]) {
            await clearCart(pool, rows[0].id);
        }
        return res.status(200).json({ data: { cleared: true } });
    }),
);

// ── POST /cart/merge  [auth required] ─────────────────────────────────────────

router.post(
    '/merge',
    authMiddleware,
    asyncHandler(async (req, res) => {
        await mergeGuestCart(pool, {
            userId: req.user.id,
            sessionId: req.sessionId,
        });
        return res.status(200).json({ data: { merged: true } });
    }),
);

export default router;
