import { NODE_ENV } from '../config/env.js';

/**
 * Map of custom error codes to HTTP status codes.
 * Throw errors with err.code set to one of these keys for automatic mapping.
 */
const ERROR_STATUS_MAP = {
    VALIDATION_ERROR: 422,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    BAD_REQUEST: 400,
    INTERNAL_ERROR: 500,
};

/**
 * PostgreSQL error code → friendly HTTP error mapping.
 * Checked before the generic fallback.
 */
const PG_ERRORS = {
    '23505': { status: 409, code: 'DUPLICATE_ENTRY', message: 'Resource already exists' },
    '23503': { status: 400, code: 'INVALID_REFERENCE', message: 'Referenced resource not found' },
    '22P02': { status: 400, code: 'INVALID_ID', message: 'Invalid ID format' },
    '42703': { status: 500, code: 'DB_COLUMN_ERROR', message: 'Internal server error' },
};

/**
 * Global Express error handler. Must be mounted last with app.use().
 * Never leaks stack traces in production.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    // express-validator ValidationError array
    if (Array.isArray(err)) {
        return res.status(422).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: err.map((e) => ({ field: e.path, message: e.msg })),
        });
    }

    // Map known PostgreSQL errors
    if (err.code && PG_ERRORS[err.code]) {
        const mapped = PG_ERRORS[err.code];
        if (mapped.status >= 500) {
            console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
        }
        return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }

    const code = err.code || 'INTERNAL_ERROR';
    const status = err.status || ERROR_STATUS_MAP[code] || 500;
    const message = err.message || 'An unexpected error occurred';

    // Log unexpected server errors
    if (status >= 500) {
        console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    }

    const body = { error: message, code };

    // Include stack trace only in non-production
    if (NODE_ENV !== 'production' && status >= 500) {
        body.stack = err.stack;
    }

    return res.status(status).json(body);
};

export default errorHandler;
