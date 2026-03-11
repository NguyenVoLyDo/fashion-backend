import { Router } from 'express';
import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import pool from '../config/db.js';
import { getAccount, getOrCreateAccount } from '../queries/loyalty.queries.js';

const router = Router();

// ── GET /loyalty ──────────────────────────────────────────────────────────────

router.get(
    '/loyalty',
    authMiddleware,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;

        // Ensure account exists securely (handles conflicts natively)
        await getOrCreateAccount(pool, userId);

        const account = await getAccount(pool, userId);

        return res.status(200).json({
            data: {
                balance: account.points_balance,
                tier: account.tier,
                totalEarned: account.total_earned,
                recentTransactions: account.recent_transactions || []
            }
        });
    })
);

export default router;
