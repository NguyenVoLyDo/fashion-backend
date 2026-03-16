/**
 * Review query functions.
 * All DB column names use snake_case; camelCase in responses via SQL aliases.
 */

// ── getProductReviews ─────────────────────────────────────────────────────────

export async function getProductReviews(pool, { productId, page, limit, sort = 'newest' }) {
    const offset = (page - 1) * limit;

    let orderBy = 'r.created_at DESC';
    if (sort === 'highest') orderBy = 'r.rating DESC, r.created_at DESC';
    if (sort === 'lowest') orderBy = 'r.rating ASC, r.created_at DESC';
    if (sort === 'images') orderBy = 'jsonb_array_length(r.images) DESC, r.created_at DESC';

    const { rows } = await pool.query(`
        SELECT 
            r.id, 
            r.rating, 
            r.title, 
            r.body, 
            r.images,
            r.is_verified AS "isVerified", 
            r.created_at AS "createdAt",
            u.full_name AS "authorName",
            COUNT(*) OVER() AS total,
            ROUND(AVG(r.rating) OVER(), 1) AS avg_rating
        FROM reviews r
        JOIN users u ON u.id = r.user_id
        WHERE r.product_id = $1 AND r.is_visible = TRUE
        ORDER BY ${orderBy}
        LIMIT $2 OFFSET $3
    `, [productId, limit, offset]);

    if (rows.length === 0) {
        return { reviews: [], total: 0, avgRating: null };
    }

    const total = parseInt(rows[0].total, 10);
    const avgRating = parseFloat(rows[0].avg_rating);
    
    // Clean up window function columns from each row
    const reviews = rows.map(r => {
        const { total: _t, avg_rating: _a, ...review } = r;
        return review;
    });

    return { reviews, total, avgRating };
}

// ── createReview ──────────────────────────────────────────────────────────────

export async function createReview(pool, { productId, userId, orderId, rating, title, body, images = [] }) {
    // 1. Check if user is verified buyer
    let isVerified = false;
    if (orderId) {
        const { rows: verifyRows } = await pool.query(`
            SELECT 1 
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN product_variants pv ON pv.id = oi.variant_id
            WHERE o.id = $1 
              AND o.user_id = $2
              AND pv.product_id = $3
              AND o.status IN ('delivered', 'completed')
        `, [orderId, userId, productId]);
        
        isVerified = verifyRows.length > 0;
    }

    // 2. Insert into reviews
    try {
        const { rows } = await pool.query(`
            INSERT INTO reviews (product_id, user_id, order_id, rating, title, body, images, is_verified)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [productId, userId, orderId || null, rating, title || null, body || null, JSON.stringify(images), isVerified]);
        
        return rows[0];
    } catch (err) {
        if (err.code === '23505') { // unique_violation
            throw Object.assign(new Error('You have already reviewed this product for this order.'), {
                code: 'ALREADY_REVIEWED',
                status: 409
            });
        }
        throw err;
    }
}

// ── getUserProductReview ──────────────────────────────────────────────────────

export async function getUserProductReview(pool, { productId, userId }) {
    const { rows } = await pool.query(`
        SELECT * 
        FROM reviews 
        WHERE product_id = $1 AND user_id = $2 AND is_visible = TRUE
    `, [productId, userId]);
    
    return rows[0] ?? null;
}

// ── softDeleteReview ──────────────────────────────────────────────────────────

export async function softDeleteReview(pool, { reviewId, userId }) {
    const { rows } = await pool.query(`
        UPDATE reviews 
        SET is_visible = FALSE
        WHERE id = $1 AND user_id = $2
        RETURNING *
    `, [reviewId, userId]);
    
    return rows[0] ?? null;
}

// ── adminSoftDeleteReview ─────────────────────────────────────────────────────

export async function adminSoftDeleteReview(pool, reviewId) {
    const { rows } = await pool.query(`
        UPDATE reviews 
        SET is_visible = FALSE 
        WHERE id = $1
        RETURNING *
    `, [reviewId]);
    
    return rows[0] ?? null;
}
