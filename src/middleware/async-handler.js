/**
 * Wraps an async Express route handler, forwarding any rejection to next(err).
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 *
 * @param {Function} fn - async Express handler (req, res, next)
 * @returns {Function} Express middleware
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
