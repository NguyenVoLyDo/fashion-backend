import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env.js';

/**
 * Verifies the JWT access token from the Authorization header.
 * Attaches the decoded payload to req.user on success.
 * Responds with 401 if token is missing or invalid.
 */
const auth = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid token', code: 'UNAUTHORIZED' });
    }

    const token = authHeader.slice(7);

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload; // { userId, role, ... }
        return next();
    } catch (err) {
        const message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
        return res.status(401).json({ error: message, code: 'UNAUTHORIZED' });
    }
};

export default auth;
