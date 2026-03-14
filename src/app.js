import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { PORT, CORS_ORIGIN } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import cartRoutes from './routes/cart.routes.js';
import orderRoutes from './routes/order.routes.js';
import adminRoutes from './routes/admin.routes.js';
import reviewRoutes from './routes/review.routes.js';
import shipmentRoutes from './routes/shipment.routes.js';
import loyaltyRoutes from './routes/loyalty.routes.js';
import voucherRoutes from './routes/voucher.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import profileRoutes from './routes/profile.routes.js';
import aiRoutes from './routes/ai.routes.js';
import stylistRoutes from './routes/stylist.routes.js';
import errorHandler from './middleware/error-handler.js';
import logger from './middleware/logger.js';

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());

// Flexible CORS for Vercel previews
const allowedOrigins = CORS_ORIGIN.split(',').map(o => o.trim());
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
    })
);

// ── Health check & ping (before rate limiters — no throttle) ──────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV,
    });
});

app.get('/api/v1/ping', (_req, res) => {
    res.json({ pong: true });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

// Global: 100 req / 1 min / IP
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
        res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' }),
});

// Auth: 10 req / 15 min / IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
        res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' }),
});

app.use(globalLimiter);

// ── Parsers ───────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ── Request logger ────────────────────────────────────────────────────────────
app.use(logger);

// ── Session ID (guest support — works for both cart and AI) ─────────────
app.use('/api/v1', (req, res, next) => {
    if (!req.cookies?.session_id) {
        const sid = crypto.randomUUID();
        res.cookie('session_id', sid, { 
            maxAge: 604800000, 
            httpOnly: true, 
            sameSite: 'none', 
            secure: true 
        });
        req.sessionId = sid;
    } else {
        req.sessionId = req.cookies.session_id;
    }
    next();
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1', catalogRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1', reviewRoutes);
app.use('/api/v1/shipments', shipmentRoutes);
app.use('/api/v1/loyalty', loyaltyRoutes);
app.use('/api/v1/vouchers', voucherRoutes);
app.use('/api/v1', uploadRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/stylist', stylistRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
});

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

export default app;
