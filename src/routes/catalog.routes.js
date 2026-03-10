import { Router } from 'express';
import { body, query, param } from 'express-validator';
import { validationResult } from 'express-validator';

import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import adminMiddleware from '../middleware/admin.js';
import pool from '../config/db.js';
import {
    getCategoryTree,
    getProducts,
    getProductBySlug,
    createProduct,
    updateProduct,
    createVariant,
    updateVariantStock,
    addProductImage,
} from '../queries/product.queries.js';

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

// ── GET /categories ───────────────────────────────────────────────────────────

router.get(
    '/categories',
    asyncHandler(async (_req, res) => {
        const categories = await getCategoryTree(pool);
        return res.status(200).json({ data: categories });
    }),
);

// ── GET /products ─────────────────────────────────────────────────────────────

router.get(
    '/products',
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('minPrice').optional().isFloat({ min: 0 }).toFloat(),
    query('maxPrice').optional().isFloat({ min: 0 }).toFloat(),
    asyncHandler(async (req, res) => {
        validate(req);

        const page = req.query.page ?? 1;
        const limit = req.query.limit ?? 20;

        const { rows, totalCount } = await getProducts(pool, {
            categorySlug: req.query.category || undefined,
            minPrice: req.query.minPrice ?? undefined,
            maxPrice: req.query.maxPrice ?? undefined,
            search: req.query.search || undefined,
            sort: req.query.sort || 'newest',
            page,
            limit,
        });

        return res.status(200).json({
            data: rows,
            meta: {
                page: Number(page),
                limit: Number(limit),
                total: totalCount,
            },
        });
    }),
);

// ── GET /products/:slug ───────────────────────────────────────────────────────

router.get(
    '/products/:slug',
    asyncHandler(async (req, res) => {
        const product = await getProductBySlug(pool, req.params.slug);
        if (!product) {
            return res.status(404).json({ error: 'Product not found', code: 'NOT_FOUND' });
        }
        return res.status(200).json({ data: product });
    }),
);

// ── POST /products  [admin] ───────────────────────────────────────────────────

router.post(
    '/products',
    authMiddleware,
    adminMiddleware,
    body('name').notEmpty().trim().withMessage('name is required'),
    body('basePrice').isFloat({ min: 0 }).withMessage('basePrice must be a non-negative number'),
    body('categoryId').isInt().withMessage('categoryId must be an integer'),
    body('slug').optional().trim(),
    body('description').optional().trim(),
    asyncHandler(async (req, res) => {
        validate(req);

        const { name, slug, description, basePrice, categoryId } = req.body;

        // Auto-generate slug from name if not provided
        const finalSlug = slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        const product = await createProduct(pool, {
            categoryId,
            name,
            slug: finalSlug,
            description,
            basePrice,
        });

        return res.status(201).json({ data: product });
    }),
);

// ── PUT /products/:id  [admin] ────────────────────────────────────────────────

router.put(
    '/products/:id',
    authMiddleware,
    adminMiddleware,
    body('name').optional().trim(),
    body('slug').optional().trim(),
    body('description').optional().trim(),
    body('basePrice').optional().isFloat({ min: 0 }),
    body('categoryId').optional().isInt(),
    body('isActive').optional().isBoolean(),
    asyncHandler(async (req, res) => {
        validate(req);

        const { name, slug, description, basePrice, categoryId, isActive } = req.body;
        const product = await updateProduct(pool, req.params.id, {
            categoryId, name, slug, description, basePrice, isActive,
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found', code: 'NOT_FOUND' });
        }

        return res.status(200).json({ data: product });
    }),
);

// ── POST /products/:id/variants  [admin] ──────────────────────────────────────

router.post(
    '/products/:id/variants',
    authMiddleware,
    adminMiddleware,
    body('sku').notEmpty().trim().withMessage('sku is required'),
    body('stockQty').isInt({ min: 0 }).withMessage('stockQty must be a non-negative integer'),
    body('price').optional().isFloat({ min: 0 }),
    body('colorId').optional().isInt(),
    body('sizeId').optional().isInt(),
    asyncHandler(async (req, res) => {
        validate(req);

        const { sku, price, stockQty, colorId, sizeId } = req.body;
        const variant = await createVariant(pool, {
            productId: req.params.id,
            colorId,
            sizeId,
            sku,
            price,
            stockQty,
        });

        return res.status(201).json({ data: variant });
    }),
);

// ── PATCH /variants/:id/stock  [admin] ────────────────────────────────────────

router.patch(
    '/variants/:id/stock',
    authMiddleware,
    adminMiddleware,
    body('delta').isInt().not().equals('0').withMessage('delta must be a non-zero integer'),
    asyncHandler(async (req, res) => {
        validate(req);

        const delta = parseInt(req.body.delta, 10);
        const variant = await updateVariantStock(pool, req.params.id, delta);

        if (variant === null) {
            return res.status(409).json({
                error: 'Stock update would make quantity negative or variant not found',
                code: 'STOCK_CONFLICT',
            });
        }

        return res.status(200).json({ data: variant });
    }),
);

// ── POST /products/:id/images  [admin] ────────────────────────────────────────

router.post(
    '/products/:id/images',
    authMiddleware,
    adminMiddleware,
    body('url').isURL().withMessage('url must be a valid URL'),
    body('isPrimary').optional().isBoolean(),
    body('sortOrder').optional().isInt({ min: 0 }),
    asyncHandler(async (req, res) => {
        validate(req);

        const { url, isPrimary = false, sortOrder = 0 } = req.body;
        const image = await addProductImage(pool, {
            productId: req.params.id,
            url,
            isPrimary,
            sortOrder,
        });

        return res.status(201).json({ data: image });
    }),
);

export default router;
