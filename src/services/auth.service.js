import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import pool from '../config/db.js';
import { JWT_SECRET } from '../config/env.js';
import {
    findUserByEmail,
    createUser,
    findRefreshToken,
    saveRefreshToken,
    deleteRefreshToken,
} from '../queries/user.queries.js';

const BCRYPT_ROUNDS = 12;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Private helper ────────────────────────────────────────────────────────────

/**
 * Generates an access token + refresh token pair, persists the refresh token
 * hash to the DB, and returns both tokens as plain strings.
 *
 * @param {{ id: number|string, email: string, role: string }} user
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
async function generateTokens(user) {
    // Access token — short-lived JWT
    const accessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '15m' },
    );

    // Refresh token — opaque random bytes; store only its hash
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await saveRefreshToken(pool, { userId: user.id, tokenHash, expiresAt });

    return { accessToken, refreshToken };
}

// ── Public service methods ────────────────────────────────────────────────────

/**
 * Register a new user.
 * @throws {{ code: 'DUPLICATE_EMAIL', status: 409 }}
 */
export async function register({ email, password, fullName, phone }) {
    // 1. Duplicate-email guard
    const existing = await findUserByEmail(pool, email);
    if (existing) {
        const err = new Error('Email already registered');
        err.code = 'DUPLICATE_EMAIL';
        err.status = 409;
        throw err;
    }

    // 2. Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // 3. Persist user
    const user = await createUser(pool, { email, passwordHash, fullName, phone });

    // 4. Issue tokens
    const { accessToken, refreshToken } = await generateTokens(user);

    return { accessToken, refreshToken, user };
}

/**
 * Authenticate with email + password.
 * @throws {{ code: 'INVALID_CREDENTIALS', status: 401 }}
 */
export async function login({ email, password }) {
    // 1. Look up user — same error for "not found" and "wrong password"
    const user = await findUserByEmail(pool, email);
    if (!user || !user.isActive) {
        const err = new Error('Invalid credentials');
        err.code = 'INVALID_CREDENTIALS';
        err.status = 401;
        throw err;
    }

    // 2. Verify password
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
        const err = new Error('Invalid credentials');
        err.code = 'INVALID_CREDENTIALS';
        err.status = 401;
        throw err;
    }

    // 3. Issue tokens (strip sensitive fields before returning user)
    const { accessToken, refreshToken } = await generateTokens(user);

    const { passwordHash: _ph, isActive: _ia, ...safeUser } = user;

    return { accessToken, refreshToken, user: safeUser };
}

/**
 * Issue a new access token from a valid refresh token.
 * Does NOT rotate the refresh token.
 * @param {string} tokenHash  SHA-256 hex of the raw refresh token
 * @throws {{ code: 'INVALID_TOKEN', status: 401 }}
 */
export async function refresh(tokenHash) {
    const record = await findRefreshToken(pool, tokenHash);
    if (!record) {
        const err = new Error('Invalid or expired refresh token');
        err.code = 'INVALID_TOKEN';
        err.status = 401;
        throw err;
    }

    const accessToken = jwt.sign(
        { id: record.userId, email: record.email, role: record.role },
        JWT_SECRET,
        { expiresIn: '15m' },
    );

    return { accessToken };
}

/**
 * Invalidate a refresh token (logout).
 * @param {string} tokenHash  SHA-256 hex of the raw refresh token
 */
export async function logout(tokenHash) {
    await deleteRefreshToken(pool, tokenHash);
}
