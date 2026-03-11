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
import { completeOrder } from '../queries/loyalty.queries.js';
import {
    createVoucher,
    getVouchers,
    updateVoucher,
    deleteVoucher,
} from '../queries/voucher.queries.js';

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

        const updated = await adminUpdateOrderStatus(pool, {
            orderId: req.params.id,
            status: req.body.status,
            changedBy: req.user.id,
        });

        return res.json({ data: updated });
    }),
);

// ── POST /admin/orders/:id/complete ───────────────────────────────────────────

router.post(
    '/orders/:id/complete',
    authMiddleware,
    requireAdmin,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const result = await completeOrder(pool, { orderId: id, changedBy: req.user.id });
        return res.status(200).json({ data: result });
    })
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

// ── Vouchers [auth + admin] ───────────────────────────────────────────────────

router.post(
    '/vouchers',
    authMiddleware,
    requireAdmin,
    body('code').notEmpty().withMessage('code is required').isString().trim(),
    body('type').isIn(['percent', 'fixed', 'free_ship']).withMessage('Invalid type'),
    body('value').isFloat({ gt: 0 }).withMessage('value must be greater than 0'),
    body('minOrderValue').optional().isFloat({ min: 0 }),
    body('maxDiscount').optional().isFloat({ min: 0 }),
    body('usageLimit').optional().isInt({ min: 1 }),
    body('validFrom').optional().isISO8601(),
    body('validUntil').optional().isISO8601(),
    asyncHandler(async (req, res) => {
        validate(req);
        try {
            const voucher = await createVoucher(pool, req.body);
            return res.status(201).json({ data: voucher });
        } catch (err) {
            if (err.code === '23505') { // unique violation
                return res.status(409).json({ error: 'Voucher code already exists', code: 'CONFLICT' });
            }
            throw err;
        }
    })
);

router.get(
    '/vouchers',
    authMiddleware,
    requireAdmin,
    asyncHandler(async (req, res) => {
        const vouchers = await getVouchers(pool);
        return res.status(200).json({ data: vouchers });
    })
);

router.patch(
    '/vouchers/:id',
    authMiddleware,
    requireAdmin,
    body('code').optional().notEmpty().isString().trim(),
    body('type').optional().isIn(['percent', 'fixed', 'free_ship']),
    body('value').optional().isFloat({ gt: 0 }),
    body('minOrderValue').optional().isFloat({ min: 0 }),
    body('maxDiscount').optional().isFloat({ min: 0 }),
    body('usageLimit').optional().isInt({ min: 1 }),
    body('validFrom').optional().isISO8601(),
    body('validUntil').optional().isISO8601(),
    body('isActive').optional().isBoolean(),
    asyncHandler(async (req, res) => {
        validate(req);
        try {
            const voucher = await updateVoucher(pool, { id: req.params.id, data: req.body });
            
            if (!voucher) {
                return res.status(404).json({ error: 'Voucher not found', code: 'NOT_FOUND' });
            }
            
            return res.status(200).json({ data: voucher });
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Voucher code already exists', code: 'CONFLICT' });
            }
            throw err;
        }
    })
);

router.delete(
    '/vouchers/:id',
    authMiddleware,
    requireAdmin,
    asyncHandler(async (req, res) => {
        await deleteVoucher(pool, req.params.id);
        return res.status(200).json({ data: { deactivated: true } });
    })
);

export default router;
