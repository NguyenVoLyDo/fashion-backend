/**
 * Role-check middleware: ensures the authenticated user has the 'admin' role.
 * Must be used AFTER the auth middleware (which sets req.user).
 * Responds with 403 Forbidden if the user is not an admin.
 */
const admin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
    }
    return next();
};

export default admin;
