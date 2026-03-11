import { Router } from 'express';
import { body, query } from 'express-validator';
import { validationResult } from 'express-validator';

import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import pool from '../config/db.js';
import { getProductBySlug } from '../queries/product.queries.js';
import {
    getProductReviews,
    createReview,
    softDeleteReview,
    adminSoftDeleteReview,
} from '../queries/review.queries.js';

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

// ── GET /products/:slug/reviews ───────────────────────────────────────────────

router.get(
    '/products/:slug/reviews',
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    asyncHandler(async (req, res) => {
        validate(req);
        const { slug } = req.params;
        const page = req.query.page ?? 1;
        const limit = req.query.limit ?? 10;

        // Verify product exists
        const product = await getProductBySlug(pool, slug);
        if (!product) {
            return res.status(404).json({ error: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
        }

        const result = await getProductReviews(pool, { productId: product.id, page, limit });

        return res.status(200).json({
            data: result.reviews,
            meta: {
                page,
                limit,
                total: result.total,
                avgRating: result.avgRating,
            },
        });
    }),
);

// ── POST /products/:slug/reviews [auth] ───────────────────────────────────────

router.post(
    '/products/:slug/reviews',
    authMiddleware,
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be an integer between 1 and 5'),
    body('title').optional().isString().trim(),
    body('body').optional().isString().trim(),
    body('orderId').optional().isInt({ min: 1 }).toInt().withMessage('orderId must be a valid integer'),
    asyncHandler(async (req, res) => {
        validate(req);
        const { slug } = req.params;

        // Verify product exists
        const product = await getProductBySlug(pool, slug);
        if (!product) {
            return res.status(404).json({ error: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
        }

        const { rating, title, body: reviewBody, orderId } = req.body;

        try {
            const review = await createReview(pool, {
                productId: product.id,
                userId: req.user.id,
                orderId,
                rating,
                title,
                body: reviewBody,
            });

            return res.status(201).json({ data: review });
        } catch (err) {
            if (err.code === 'ALREADY_REVIEWED') {
                return res.status(409).json({ error: err.message, code: err.code });
            }
            throw err;
        }
    }),
);

// ── DELETE /reviews/:id [auth] ────────────────────────────────────────────────

router.delete(
    '/reviews/:id',
    authMiddleware,
    asyncHandler(async (req, res) => {
        const review = await softDeleteReview(pool, { reviewId: req.params.id, userId: req.user.id });
        if (!review) {
            return res.status(404).json({ error: 'Review not found or not owned by user', code: 'REVIEW_NOT_FOUND' });
        }
        return res.status(200).json({ data: { deleted: true } });
    }),
);

// ── DELETE /admin/reviews/:id [auth + admin] ──────────────────────────────────

router.delete(
    '/admin/reviews/:id',
    authMiddleware,
    requireAdmin,
    asyncHandler(async (req, res) => {
        const review = await adminSoftDeleteReview(pool, req.params.id);
        if (!review) {
            return res.status(404).json({ error: 'Review not found', code: 'REVIEW_NOT_FOUND' });
        }
        return res.status(200).json({ data: { deleted: true } });
    }),
);

export default router;
