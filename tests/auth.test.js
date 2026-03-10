import {
    describe,
    it,
    expect,
    beforeAll,
    afterAll,
} from 'vitest';
import request from 'supertest';
import pg from 'pg';

import app from '../src/app.js';

// ── Test DB pool ──────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
    await pool.query('TRUNCATE TABLE refresh_tokens, users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
    await pool.end();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validUser = {
    email: 'test@fashion.vn',
    password: 'password123',
    fullName: 'Test User',
    phone: '0901234567',
};

// ── Register ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
    it('201 with valid data → returns accessToken and sets cookie', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send(validUser);

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveProperty('accessToken');
        expect(res.body.data.user).not.toHaveProperty('passwordHash');
        expect(res.headers['set-cookie']).toBeDefined();
        expect(res.headers['set-cookie'][0]).toMatch(/refresh_token=/);
    });

    it('409 DUPLICATE_EMAIL on second register with same email', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send(validUser);

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DUPLICATE_EMAIL');
    });

    it('400 when fullName is missing', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ email: 'other@fashion.vn', password: 'password123' });

        expect(res.status).toBe(400);
    });

    it('400 when password is shorter than 8 chars', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ email: 'other2@fashion.vn', password: 'short', fullName: 'User' });

        expect(res.status).toBe(400);
    });
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
    it('200 with correct credentials → accessToken in body and cookie set', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: validUser.email, password: validUser.password });

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('accessToken');
        expect(res.headers['set-cookie']).toBeDefined();
    });

    it('401 INVALID_CREDENTIALS with wrong password', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: validUser.email, password: 'wrongpassword' });

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('401 INVALID_CREDENTIALS with unknown email (not 404)', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'nobody@fashion.vn', password: 'password123' });

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });
});

// ── Token refresh ─────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
    let refreshCookie;

    beforeAll(async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: validUser.email, password: validUser.password });
        refreshCookie = res.headers['set-cookie'];
    });

    it('200 with valid cookie → returns new accessToken', async () => {
        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', refreshCookie);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('accessToken');
    });

    it('401 with garbage refresh token', async () => {
        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .send({ refreshToken: 'garbage_token_that_does_not_exist' });

        expect(res.status).toBe(401);
    });
});

// ── /me endpoints ─────────────────────────────────────────────────────────────

describe('GET /api/v1/auth/me', () => {
    let accessToken;
    let refreshCookie;

    beforeAll(async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: validUser.email, password: validUser.password });
        accessToken = res.body.data.accessToken;
        refreshCookie = res.headers['set-cookie'];
    });

    it('200 with valid Bearer token → user object without passwordHash', async () => {
        const res = await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('email', validUser.email);
        expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('401 with no token', async () => {
        const res = await request(app).get('/api/v1/auth/me');
        expect(res.status).toBe(401);
    });

    it('POST /logout → 200, cookie cleared; JWT access token still works (stateless)', async () => {
        // Log out (invalidates refresh token in DB)
        const logoutRes = await request(app)
            .post('/api/v1/auth/logout')
            .set('Cookie', refreshCookie);

        expect(logoutRes.status).toBe(200);
        // Cookie should be cleared
        expect(logoutRes.headers['set-cookie'][0]).toMatch(/refresh_token=;/);

        // JWT access token is stateless — it remains valid until expiry
        const meRes = await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${accessToken}`);

        expect(meRes.status).toBe(200);
    });
});
