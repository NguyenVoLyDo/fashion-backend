import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env.js';

/**
 * Optional JWT authentication middleware.
 * If a Bearer token is present and valid, populates req.user.
 * If no token (or invalid), req.user remains undefined — does NOT send 401.
 */
const optionalAuth = (req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
            req.user = jwt.verify(token, JWT_SECRET);
        } catch {
            // Token invalid or expired — treat as unauthenticated
        }
    }
    next();
};

export default optionalAuth;
