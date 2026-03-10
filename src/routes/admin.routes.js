import { Router } from 'express';
import { body, query } from 'express-validator';
import { validationResult } from 'express-validator';

import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import pool from '../config/db.js';
import {
    adminListOrders,
    adminUpdateOrderStatus,
} from '../queries/order.queries.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Middleware: require that the authenticated user has the 'admin' role. */
function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
}

const VALID_STATUSES = [
    'confirmed', 'processing', 'shipped',
    'delivered', 'completed', 'cancelled', 'refunded',
];

// ── GET /admin/orders  [auth + admin] ─────────────────────────────────────────

router.get(
    '/orders',
    authMiddleware,
    requireAdmin,
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    asyncHandler(async (req, res) => {
        const page = req.query.page ?? 1;
        const limit = req.query.limit ?? 20;
        const status = req.query.status ?? null;

        const { orders, total } = await adminListOrders(pool, { status, page, limit });

        return res.status(200).json({
            data: orders,
            meta: { page, limit, total },
        });
    }),
);

// ── PATCH /admin/orders/:id/status  [auth + admin] ───────────────────────────

router.patch(
    '/orders/:id/status',
    authMiddleware,
    requireAdmin,
    body('status')
        .isIn(VALID_STATUSES)
        .withMessage(`status must be one of: ${VALID_STATUSES.join(', ')}`),
    asyncHandler(async (req, res) => {
        validate(req);

        const order = await adminUpdateOrderStatus(pool, {
            orderId: req.params.id,
            status: req.body.status,
            changedBy: req.user.id,
        });

        return res.status(200).json({ data: order });
    }),
);

// ── GET /admin/stats  [auth + admin] ─────────────────────────────────────────

router.get(
    '/stats',
    authMiddleware,
    requireAdmin,
    asyncHandler(async (req, res) => {
        const { rows } = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM orders
                 WHERE status NOT IN ('cancelled','refunded'))           AS "totalOrders",
                (SELECT COALESCE(SUM(total),0) FROM orders
                 WHERE status = 'completed')                            AS "totalRevenue",
                (SELECT COUNT(*) FROM users
                 WHERE role = 'customer')                               AS "totalCustomers",
                (SELECT COUNT(*) FROM products
                 WHERE is_active = TRUE)                                AS "totalProducts",
                (SELECT COUNT(*) FROM orders
                 WHERE status = 'pending')                              AS "pendingOrders",
                (SELECT COUNT(*) FROM product_variants
                 WHERE stock <= 5 AND is_active = TRUE)                 AS "lowStockCount"
        `);

        return res.status(200).json({ data: rows[0] });
    }),
);

export default router;
