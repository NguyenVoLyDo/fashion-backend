import { Router } from 'express';
import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import pool from '../config/db.js';
import { getAccount, getOrCreateAccount } from '../queries/loyalty.queries.js';

const router = Router();

// ── GET /loyalty ──────────────────────────────────────────────────────────────

router.get(
    '/me',
    authMiddleware,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;

        // Ensure account exists securely (handles conflicts natively)
        await getOrCreateAccount(pool, userId);

        const account = await getAccount(pool, userId);

        const points = Number(account.points_balance);
        const totalEarned = Number(account.total_earned);
        
        let nextTier = null;
        let pointsToNextTier = null;
        
        if (totalEarned < 1000) {
            nextTier = 'silver';
            pointsToNextTier = 1000 - totalEarned;
        } else if (totalEarned < 5000) {
            nextTier = 'gold';
            pointsToNextTier = 5000 - totalEarned;
        } else if (totalEarned < 20000) {
            nextTier = 'platinum';
            pointsToNextTier = 20000 - totalEarned;
        }

        return res.status(200).json({
            data: {
                points,
                balance: points, // fallback
                tier: account.tier,
                totalEarned,
                nextTier,
                pointsToNextTier,
                recentTransactions: account.recent_transactions || []
            }
        });
    })
);

export default router;
