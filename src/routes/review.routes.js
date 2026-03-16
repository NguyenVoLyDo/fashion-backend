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
    query('sort').optional().isIn(['newest', 'highest', 'lowest', 'images']),
    query('rating').optional().isInt({ min: 1, max: 5 }).toInt(),
    asyncHandler(async (req, res) => {
        validate(req);
        const { slug } = req.params;
        const page = req.query.page ?? 1;
        const limit = req.query.limit ?? 10;
        const sort = req.query.sort ?? 'newest';
        const rating = req.query.rating;

        // Verify product exists
        const product = await getProductBySlug(pool, slug);
        if (!product) {
            return res.status(404).json({ error: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
        }

        const result = await getProductReviews(pool, { productId: product.id, page, limit, sort, rating });

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

// ── GET /products/:slug/reviews/overview ──────────────────────────────────────

router.get(
    '/products/:slug/reviews/overview',
    asyncHandler(async (req, res) => {
        const { slug } = req.params;
        const product = await getProductBySlug(pool, slug);
        if (!product) {
            return res.status(404).json({ error: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
        }

        const { rows } = await pool.query(`
            SELECT 
                rating, 
                COUNT(*) as count
            FROM reviews
            WHERE product_id = $1 AND is_visible = TRUE
            GROUP BY rating
        `, [product.id]);

        const countsByRating = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalCount = 0;
        let sumRating = 0;

        rows.forEach(row => {
            const r = parseInt(row.rating, 10);
            const c = parseInt(row.count, 10);
            countsByRating[r] = c;
            totalCount += c;
            sumRating += r * c;
        });

        const avgRating = totalCount > 0 ? sumRating / totalCount : 0;

        return res.json({
            data: {
                avgRating,
                totalCount,
                countsByRating
            }
        });
    })
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

        const { rating, title, body: reviewBody, orderId, images } = req.body;

        try {
            const review = await createReview(pool, {
                productId: product.id,
                userId: req.user.id,
                orderId,
                rating,
                title,
                body: reviewBody,
                images,
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
