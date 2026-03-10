/**
 * Cart query functions.
 * Supports both authenticated users (userId) and anonymous guests (sessionId).
 * snake_case → camelCase via SQL aliases.
 */

// ── Cart retrieval / creation ─────────────────────────────────────────────────

/**
 * Find the cart for the given user or session.
 * Creates a new one if none exists.
 *
 * @param {import('pg').Pool} pool
 * @param {{ userId?: number|null, sessionId?: string|null }} opts
 * @returns {Promise<number>} cart id
 */
export async function getOrCreateCart(pool, { userId, sessionId }) {
    // Try to find existing cart
    if (userId) {
        const { rows } = await pool.query(
            `SELECT id FROM carts WHERE user_id = $1 LIMIT 1`,
            [userId],
        );
        if (rows[0]) return rows[0].id;
        // Create for this user
        const { rows: created } = await pool.query(
            `INSERT INTO carts (user_id) VALUES ($1) RETURNING id`,
            [userId],
        );
        return created[0].id;
    }

    // Guest: identify by session_id
    const { rows } = await pool.query(
        `SELECT id FROM carts WHERE session_id = $1 LIMIT 1`,
        [sessionId],
    );
    if (rows[0]) return rows[0].id;
    const { rows: created } = await pool.query(
        `INSERT INTO carts (session_id) VALUES ($1) RETURNING id`,
        [sessionId],
    );
    return created[0].id;
}

/**
 * Fetch cart with full item details.
 * Returns [] when no cart exists for the given identity.
 *
 * @param {import('pg').Pool} pool
 * @param {{ userId?: number|null, sessionId?: string|null }} opts
 * @returns {Promise<Array>}
 */
export async function getCartWithItems(pool, { userId, sessionId }) {
    const cartCondition = userId
        ? 'c.user_id = $1'
        : 'c.session_id = $1';
    const identity = userId ?? sessionId;

    const { rows } = await pool.query(`
        SELECT
            ci.id                                   AS id,
            ci.quantity,
            ci.price_at                             AS "priceAt",
            pv.id                                   AS "variantId",
            pv.sku,
            COALESCE(pv.price, p.base_price)        AS "currentPrice",
            pv.stock,
            p.name                                  AS "productName",
            p.slug                                  AS "productSlug",
            co.name                                 AS "colorName",
            co.hex                                  AS "hexCode",
            sz.name                                 AS "sizeLabel",
            img.url                                 AS "imageUrl"
        FROM   carts c
        JOIN   cart_items ci ON ci.cart_id = c.id
        JOIN   product_variants pv ON pv.id = ci.variant_id
        JOIN   products p ON p.id = pv.product_id
        LEFT JOIN colors co ON co.id = pv.color_id
        LEFT JOIN sizes  sz ON sz.id = pv.size_id
        LEFT JOIN LATERAL (
            SELECT pi.url
            FROM   product_images pi
            WHERE  pi.product_id = p.id AND pi.is_primary = TRUE
            LIMIT  1
        ) img ON TRUE
        WHERE  ${cartCondition}
        ORDER  BY ci.added_at
    `, [identity]);

    return rows;
}

// ── Variant pricing ───────────────────────────────────────────────────────────

/**
 * Fetch the effective price and available stock for a variant.
 * Returns null if the variant doesn't exist or is inactive.
 *
 * @param {import('pg').Pool} pool
 * @param {number|string} variantId
 * @returns {Promise<{ price: number, stock: number }|null>}
 */
export async function getPriceForVariant(pool, variantId) {
    const { rows } = await pool.query(`
        SELECT COALESCE(pv.price, p.base_price) AS price,
               pv.stock
        FROM   product_variants pv
        JOIN   products p ON p.id = pv.product_id
        WHERE  pv.id = $1
          AND  pv.is_active = TRUE
        LIMIT  1
    `, [variantId]);
    return rows[0] ?? null;
}

// ── Cart item mutations ───────────────────────────────────────────────────────

/**
 * Insert a new cart item, or add to quantity if the variant already exists.
 *
 * @param {import('pg').Pool} pool
 * @param {{ cartId: number, variantId: number, quantity: number, priceAt: number }} opts
 * @returns {Promise<object>} upserted item row
 */
export async function upsertCartItem(pool, { cartId, variantId, quantity, priceAt }) {
    const { rows } = await pool.query(`
        INSERT INTO cart_items (cart_id, variant_id, quantity, price_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (cart_id, variant_id)
        DO UPDATE SET
            quantity = cart_items.quantity + EXCLUDED.quantity,
            price_at = EXCLUDED.price_at
        RETURNING id,
                  cart_id    AS "cartId",
                  variant_id AS "variantId",
                  quantity,
                  price_at   AS "priceAt"
    `, [cartId, variantId, quantity, priceAt]);
    return rows[0];
}

/**
 * Change the absolute quantity on an item.
 * Ownership enforced by requiring the cartId.
 *
 * @returns {Promise<object|null>} updated row, or null if not found
 */
export async function updateCartItemQty(pool, { itemId, cartId, quantity }) {
    const { rows } = await pool.query(`
        UPDATE cart_items
        SET    quantity = $3
        WHERE  id = $1 AND cart_id = $2
        RETURNING id,
                  cart_id    AS "cartId",
                  variant_id AS "variantId",
                  quantity,
                  price_at   AS "priceAt"
    `, [itemId, cartId, quantity]);
    return rows[0] ?? null;
}

/**
 * Remove a single item.
 * Ownership enforced by requiring the cartId.
 *
 * @returns {Promise<object|null>} deleted row, or null if not found
 */
export async function deleteCartItem(pool, { itemId, cartId }) {
    const { rows } = await pool.query(`
        DELETE FROM cart_items
        WHERE  id = $1 AND cart_id = $2
        RETURNING id, variant_id AS "variantId", quantity
    `, [itemId, cartId]);
    return rows[0] ?? null;
}

/**
 * Remove all items in a cart.
 *
 * @param {import('pg').Pool} pool
 * @param {number} cartId
 */
export async function clearCart(pool, cartId) {
    await pool.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
}

// ── Guest → user merge ────────────────────────────────────────────────────────

/**
 * Move all items from the guest session cart into the user's cart.
 * Uses a transaction; deletes the guest cart afterwards.
 *
 * @param {import('pg').Pool} pool
 * @param {{ userId: number, sessionId: string }} opts
 */
export async function mergeGuestCart(pool, { userId, sessionId }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch both carts
        const { rows: userCarts } = await client.query(
            `SELECT id FROM carts WHERE user_id = $1 LIMIT 1`, [userId],
        );
        const { rows: guestCarts } = await client.query(
            `SELECT id FROM carts WHERE session_id = $1 LIMIT 1`, [sessionId],
        );

        if (!guestCarts[0]) {
            // Nothing to merge
            await client.query('COMMIT');
            return;
        }

        const guestCartId = guestCarts[0].id;

        // Ensure user cart exists
        let userCartId;
        if (userCarts[0]) {
            userCartId = userCarts[0].id;
        } else {
            const { rows } = await client.query(
                `INSERT INTO carts (user_id) VALUES ($1) RETURNING id`, [userId],
            );
            userCartId = rows[0].id;
        }

        // Fetch guest items
        const { rows: guestItems } = await client.query(
            `SELECT variant_id, quantity, price_at FROM cart_items WHERE cart_id = $1`,
            [guestCartId],
        );

        // Merge each guest item into user cart
        for (const item of guestItems) {
            await client.query(`
                INSERT INTO cart_items (cart_id, variant_id, quantity, price_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (cart_id, variant_id)
                DO UPDATE SET
                    quantity = cart_items.quantity + EXCLUDED.quantity,
                    price_at = EXCLUDED.price_at
            `, [userCartId, item.variant_id, item.quantity, item.price_at]);
        }

        // Remove guest cart (cascades to guest cart_items)
        await client.query(`DELETE FROM carts WHERE id = $1`, [guestCartId]);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}
