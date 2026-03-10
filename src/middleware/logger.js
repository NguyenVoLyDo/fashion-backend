/**
 * Minimal request logger — no external packages.
 * Skips /health to avoid log spam.
 */
export default function logger(req, res, next) {
    if (req.path === '/health') return next();

    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        const userId = req.user?.id ? ` user=${String(req.user.id).slice(0, 8)}` : '';
        console.log(
            `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms${userId}`
        );
    });
    next();
}
