import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';

import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import * as authService from '../services/auth.service.js';
import { findUserById, updateUser } from '../queries/user.queries.js';
import pool from '../config/db.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Extract raw refresh token from cookie or request body */
function getRawToken(req) {
    return req.cookies?.refresh_token || req.body?.refreshToken || null;
}

/** SHA-256 hex hash of a raw token string */
function hashToken(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Set the httpOnly refresh_token cookie */
function setRefreshCookie(res, refreshToken) {
    res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        sameSite: 'none', // Allow cross-site for Vercel -> Railway
        secure: true,      // REQUIRED for sameSite: 'none'
        maxAge: SEVEN_DAYS_MS,
    });
}

/** Run express-validator and throw the errors array (caught by error-handler) */
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

// ── POST /register ────────────────────────────────────────────────────────────

router.post(
    '/register',
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('fullName').notEmpty().trim().withMessage('fullName is required'),
    asyncHandler(async (req, res) => {
        validate(req);

        const { email, password, fullName, phone } = req.body;
        const { accessToken, refreshToken, user } = await authService.register({
            email,
            password,
            fullName,
            phone,
        });

        setRefreshCookie(res, refreshToken);

        return res.status(201).json({ data: { user, accessToken } });
    }),
);

// ── POST /login ───────────────────────────────────────────────────────────────

router.post(
    '/login',
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
    asyncHandler(async (req, res) => {
        validate(req);

        const { email, password } = req.body;
        const { accessToken, refreshToken, user } = await authService.login({ email, password });

        setRefreshCookie(res, refreshToken);

        return res.status(200).json({ data: { user, accessToken } });
    }),
);

// ── POST /refresh ─────────────────────────────────────────────────────────────

router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
        const raw = getRawToken(req);

        if (!raw) {
            return res.status(401).json({ error: 'Missing refresh token', code: 'MISSING_TOKEN' });
        }

        const tokenHash = hashToken(raw);
        const { accessToken } = await authService.refresh(tokenHash);

        return res.status(200).json({ data: { accessToken } });
    }),
);

// ── POST /logout ──────────────────────────────────────────────────────────────

router.post(
    '/logout',
    asyncHandler(async (req, res) => {
        const raw = getRawToken(req);

        if (raw) {
            await authService.logout(hashToken(raw));
        }

        res.clearCookie('refresh_token', { 
            httpOnly: true, 
            sameSite: 'none', 
            secure: true 
        });

        return res.status(200).json({ data: { message: 'Logged out' } });
    }),
);

// ── GET /me ───────────────────────────────────────────────────────────────────

router.get(
    '/me',
    authMiddleware,
    asyncHandler(async (req, res) => {
        const user = await findUserById(pool, req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
        }

        return res.status(200).json({ data: user });
    }),
);

// ── PUT /me ───────────────────────────────────────────────────────────────────

router.put(
    '/me',
    authMiddleware,
    body('fullName').optional().trim(),
    body('phone').optional().trim(),
    asyncHandler(async (req, res) => {
        validate(req);

        const { fullName, phone } = req.body;
        const user = await updateUser(pool, req.user.id, { fullName, phone });

        return res.status(200).json({ data: user });
    }),
);

export default router;
