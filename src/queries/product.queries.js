/**
 * Product, category, variant, and image query functions.
 * All use parameterised $1 $2… placeholders — never string concat.
 * snake_case → camelCase transformation happens here in SQL aliases.
 */

// ── Categories ────────────────────────────────────────────────────────────────

/**
 * Returns the full category tree as a flat list with `depth` so the caller
 * can reconstruct nesting. Uses a recursive CTE starting at root nodes.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{id, name, slug, parentId, depth}>>}
 */
export async function getCategoryTree(pool) {
    const { rows } = await pool.query(`
        WITH RECURSIVE tree AS (
            -- Anchor: root categories
            SELECT id,
                   name,
                   slug,
                   parent_id,
                   0 AS depth
            FROM   categories
            WHERE  parent_id IS NULL

            UNION ALL

            -- Recursive: children
            SELECT c.id,
                   c.name,
                   c.slug,
                   c.parent_id,
                   tree.depth + 1
            FROM   categories c
            JOIN   tree ON tree.id = c.parent_id
        )
        SELECT id,
               name,
               slug,
               parent_id  AS "parentId",
               depth
        FROM   tree
        ORDER  BY depth, name
    `);
    return rows;
}

// ── Products list ─────────────────────────────────────────────────────────────

/**
 * Paginated product listing with optional filters and full-text search.
 *
 * @param {import('pg').Pool} pool
 * @param {{ categorySlug?, minPrice?, maxPrice?, search?, sort?, page?, limit? }} opts
 * @returns {Promise<{ rows: Array, totalCount: number }>}
 */
export async function getProducts(pool, {
    categorySlug,
    minPrice,
    maxPrice,
    search,
    sort = 'newest',
    page = 1,
    limit = 20,
} = {}) {
    const params = [];
    const conditions = ['p.is_active = TRUE'];

    // --- category filter ---
    if (categorySlug) {
        params.push(categorySlug);
        conditions.push(`c.slug = $${params.length}`);
    }

    // --- price filters ---
    if (minPrice != null) {
        params.push(Number(minPrice));
        conditions.push(`COALESCE(v.min_price, p.base_price) >= $${params.length}`);
    }
    if (maxPrice != null) {
        params.push(Number(maxPrice));
        conditions.push(`COALESCE(v.min_price, p.base_price) <= $${params.length}`);
    }

    // --- full-text search ---
    if (search) {
        params.push(search);
        conditions.push(
            `to_tsvector('simple', p.name || ' ' || COALESCE(p.description, ''))
             @@ plainto_tsquery('simple', $${params.length})`,
        );
    }

    // --- sorting ---
    const orderMap = {
        price_asc: 'COALESCE(v.min_price, p.base_price) ASC',
        price_desc: 'COALESCE(v.min_price, p.base_price) DESC',
        newest: 'p.created_at DESC',
    };
    const orderClause = orderMap[sort] ?? orderMap.newest;

    // --- pagination ---
    const offset = (Number(page) - 1) * Number(limit);
    params.push(Number(limit));
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const where = conditions.join(' AND ');

    const sql = `
        SELECT p.id,
               p.name,
               p.slug,
               p.base_price       AS "basePrice",
               p.created_at       AS "createdAt",
               c.id               AS "categoryId",
               c.name             AS "categoryName",
               c.slug             AS "categorySlug",
               img.url            AS "primaryImage",
               COALESCE(v.total_stock, 0)  AS "totalStock",
               COALESCE(v.min_price, p.base_price) AS "minPrice",
               COUNT(*) OVER()    AS total_count
        FROM   products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN LATERAL (
            SELECT MIN(pv.price)  AS min_price,
                   SUM(pv.stock)  AS total_stock
            FROM   product_variants pv
            WHERE  pv.product_id = p.id
        ) v ON TRUE
        LEFT JOIN LATERAL (
            SELECT pi.url
            FROM   product_images pi
            WHERE  pi.product_id = p.id AND pi.is_primary = TRUE
            LIMIT 1
        ) img ON TRUE
        WHERE  ${where}
        ORDER  BY ${orderClause}
        LIMIT  $${limitParam}
        OFFSET $${offsetParam}
    `;

    const { rows } = await pool.query(sql, params);
    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;

    // Strip the window-function column from result rows
    const cleanRows = rows.map(({ total_count, ...rest }) => rest);

    return { rows: cleanRows, totalCount };
}

// ── Product detail ────────────────────────────────────────────────────────────

/**
 * Full product detail with aggregated images and variants.
 *
 * @param {import('pg').Pool} pool
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getProductBySlug(pool, slug) {
    const { rows } = await pool.query(`
        SELECT p.id,
               p.name,
               p.slug,
               p.description,
               p.base_price            AS "basePrice",
               p.is_active             AS "isActive",
               p.created_at            AS "createdAt",
               p.updated_at            AS "updatedAt",
               c.id                    AS "categoryId",
               c.name                  AS "categoryName",
               c.slug                  AS "categorySlug",
               COALESCE(imgs.images, '[]'::json)    AS images,
               COALESCE(vars.variants, '[]'::json)  AS variants
        FROM   products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN LATERAL (
            SELECT json_agg(
                       json_build_object(
                           'id',        pi.id,
                           'url',       pi.url,
                           'isPrimary', pi.is_primary,
                           'sortOrder', pi.sort_order
                       ) ORDER BY pi.sort_order
                   ) AS images
            FROM product_images pi
            WHERE pi.product_id = p.id
        ) imgs ON TRUE
        LEFT JOIN LATERAL (
            SELECT json_agg(
                       json_build_object(
                           'id',       pv.id,
                           'sku',      pv.sku,
                           'price',    pv.price,
                           'stock',    pv.stock,
                           'color',    CASE WHEN co.id IS NOT NULL
                                            THEN json_build_object('id', co.id, 'name', co.name, 'hex', co.hex)
                                            ELSE NULL END,
                           'size',     CASE WHEN sz.id IS NOT NULL
                                            THEN json_build_object('id', sz.id, 'name', sz.name)
                                            ELSE NULL END
                       )
                   ) AS variants
            FROM   product_variants pv
            LEFT JOIN colors co ON co.id = pv.color_id
            LEFT JOIN sizes  sz ON sz.id = pv.size_id
            WHERE  pv.product_id = p.id
        ) vars ON TRUE
        WHERE  p.slug = $1
          AND  p.is_active = TRUE
    `, [slug]);

    return rows[0] ?? null;
}

// ── Admin: create / update product ───────────────────────────────────────────

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<object>} new product row
 */
export async function createProduct(pool, { categoryId, name, slug, description, basePrice }) {
    const { rows } = await pool.query(`
        INSERT INTO products (category_id, name, slug, description, base_price)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id,
                  category_id  AS "categoryId",
                  name,
                  slug,
                  description,
                  base_price   AS "basePrice",
                  is_active    AS "isActive",
                  created_at   AS "createdAt"
    `, [categoryId ?? null, name, slug, description ?? null, basePrice]);
    return rows[0];
}

/**
 * @param {import('pg').Pool} pool
 * @param {number|string} id
 * @param {{ categoryId?, name?, slug?, description?, basePrice?, isActive? }} fields
 * @returns {Promise<object>} updated product row
 */
export async function updateProduct(pool, id, { categoryId, name, slug, description, basePrice, isActive }) {
    const { rows } = await pool.query(`
        UPDATE products
        SET    category_id  = COALESCE($2, category_id),
               name         = COALESCE($3, name),
               slug         = COALESCE($4, slug),
               description  = COALESCE($5, description),
               base_price   = COALESCE($6, base_price),
               is_active    = COALESCE($7, is_active),
               updated_at   = NOW()
        WHERE  id = $1
        RETURNING id,
                  category_id  AS "categoryId",
                  name,
                  slug,
                  description,
                  base_price   AS "basePrice",
                  is_active    AS "isActive",
                  updated_at   AS "updatedAt"
    `, [id, categoryId ?? null, name ?? null, slug ?? null, description ?? null,
        basePrice ?? null, isActive ?? null]);
    return rows[0];
}

// ── Admin: variants ───────────────────────────────────────────────────────────

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<object>} new variant row
 */
export async function createVariant(pool, { productId, colorId, sizeId, sku, price, stockQty }) {
    const { rows } = await pool.query(`
        INSERT INTO product_variants (product_id, color_id, size_id, sku, price, stock)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id,
                  product_id  AS "productId",
                  color_id    AS "colorId",
                  size_id     AS "sizeId",
                  sku,
                  price,
                  stock
    `, [productId, colorId ?? null, sizeId ?? null, sku, price ?? 0, stockQty ?? 0]);
    return rows[0];
}

/**
 * Atomically adjusts stock by `delta`. Returns null if the row doesn't exist
 * or if the result would be negative (caller should respond 409).
 *
 * @param {import('pg').Pool} pool
 * @param {number|string} variantId
 * @param {number} delta  positive or negative integer
 * @returns {Promise<object|null>}
 */
export async function updateVariantStock(pool, variantId, delta) {
    const { rows } = await pool.query(`
        UPDATE product_variants
        SET    stock = stock + $2
        WHERE  id = $1
          AND  stock + $2 >= 0
        RETURNING id,
                  product_id  AS "productId",
                  sku,
                  stock
    `, [variantId, delta]);
    return rows[0] ?? null;
}

// ── Admin: images ─────────────────────────────────────────────────────────────

/**
 * Adds an image to a product. If `isPrimary` is true, clears the flag on all
 * other images first (within the same transaction-like sequence).
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<object>} new image row
 */
export async function addProductImage(pool, { productId, url, isPrimary = false, sortOrder = 0 }) {
    if (isPrimary) {
        await pool.query(
            `UPDATE product_images SET is_primary = FALSE WHERE product_id = $1`,
            [productId],
        );
    }
    const { rows } = await pool.query(`
        INSERT INTO product_images (product_id, url, is_primary, sort_order)
        VALUES ($1, $2, $3, $4)
        RETURNING id,
                  product_id  AS "productId",
                  url,
                  is_primary  AS "isPrimary",
                  sort_order  AS "sortOrder"
    `, [productId, url, isPrimary, sortOrder]);
    return rows[0];
}
