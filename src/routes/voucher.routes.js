import { Router } from 'express';
import { body } from 'express-validator';
import { validationResult } from 'express-validator';
import asyncHandler from '../middleware/async-handler.js';
import pool from '../config/db.js';
import { validateVoucher, calculateDiscount } from '../queries/voucher.queries.js';

const router = Router();

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

// POST /vouchers/validate
router.post(
    '/validate',
    body('code').notEmpty().isString().trim(),
    body('orderAmount').isFloat({ min: 0 }).toFloat(),
    asyncHandler(async (req, res) => {
        validate(req);
        const { code, orderAmount } = req.body;

        try {
            const voucher = await validateVoucher(pool, { code, subtotal: orderAmount });
            const discountAmount = calculateDiscount(voucher, orderAmount);

            return res.status(200).json({
                data: {
                    id: voucher.id,
                    code: voucher.code,
                    type: voucher.type,
                    value: Number(voucher.value),
                    discountAmount,
                }
            });
        } catch (err) {
            if (err.code && err.code.startsWith('VOUCHER_')) {
                return res.status(400).json({
                    error: err.message,
                    code: err.code,
                    data: err.data
                });
            }
            throw err;
        }
    })
);

export default router;
