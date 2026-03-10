import { Router } from 'express';
import { body, query } from 'express-validator';
import { validationResult } from 'express-validator';

import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import pool from '../config/db.js';
import { checkout } from '../services/order.service.js';
import { verifyVnpayWebhook, verifyMomoWebhook } from '../services/payment.service.js';
import {
    getOrdersByUser,
    getOrderById,
    cancelOrder,
    confirmPayment,
} from '../queries/order.queries.js';

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

// ── POST /orders  [auth required] ─────────────────────────────────────────────

router.post(
    '/',
    authMiddleware,
    body('addressId').notEmpty().withMessage('addressId is required'),
    body('method')
        .isIn(['cod', 'vnpay', 'momo'])
        .withMessage('method must be one of: cod, vnpay, momo'),
    asyncHandler(async (req, res) => {
        validate(req);

        try {
            const result = await checkout(pool, {
                userId: req.user.id,
                addressId: req.body.addressId,
                method: req.body.method,
            });
            return res.status(201).json({ data: result });
        } catch (err) {
            if (err.code === 'OUT_OF_STOCK') {
                return res.status(409).json({
                    error: err.message,
                    code: err.code,
                    data: err.data,
                });
            }
            if (err.code === 'ADDRESS_NOT_FOUND' || err.code === 'EMPTY_CART') {
                return res.status(400).json({ error: err.message, code: err.code });
            }
            throw err;
        }
    }),
);

// ── GET /orders  [auth required] ──────────────────────────────────────────────

router.get(
    '/',
    authMiddleware,
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    asyncHandler(async (req, res) => {
        const page = req.query.page ?? 1;
        const limit = req.query.limit ?? 10;

        const { orders, total } = await getOrdersByUser(pool, {
            userId: req.user.id,
            page,
            limit,
        });

        return res.status(200).json({
            data: orders,
            meta: { page, limit, total },
        });
    }),
);

// ── GET /orders/:id  [auth required] ──────────────────────────────────────────

router.get(
    '/:id',
    authMiddleware,
    asyncHandler(async (req, res) => {
        const order = await getOrderById(pool, {
            orderId: req.params.id,
            userId: req.user.id,
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found', code: 'ORDER_NOT_FOUND' });
        }

        return res.status(200).json({ data: order });
    }),
);

// ── PATCH /orders/:id/cancel  [auth required] ────────────────────────────────

router.patch(
    '/:id/cancel',
    authMiddleware,
    asyncHandler(async (req, res) => {
        const updated = await cancelOrder(pool, {
            orderId: req.params.id,
            userId: req.user.id,
        });

        if (!updated) {
            return res.status(409).json({
                error: 'Order cannot be cancelled (does not exist or is not pending)',
                code: 'CANNOT_CANCEL',
            });
        }

        return res.status(200).json({
            data: {
                orderId: updated.id,
                orderNo: updated.orderNo,
                status: updated.status,
            },
        });
    }),
);

// ── POST /webhooks/vnpay  [no auth – verify in service] ──────────────────────

router.post(
    '/webhooks/vnpay',
    asyncHandler(async (req, res) => {
        const { orderId, success, txnId } = verifyVnpayWebhook(req.query);
        if (success) {
            await confirmPayment(pool, { orderId, txnId, gatewayData: req.query });
        }
        return res.status(200).json({ data: { ok: true } });
    }),
);

// ── POST /webhooks/momo  [no auth – verify in service] ───────────────────────

router.post(
    '/webhooks/momo',
    asyncHandler(async (req, res) => {
        const { orderId, success, txnId } = verifyMomoWebhook(req.body);
        if (success) {
            await confirmPayment(pool, { orderId, txnId, gatewayData: req.body });
        }
        return res.status(200).json({ data: { ok: true } });
    }),
);

export default router;
