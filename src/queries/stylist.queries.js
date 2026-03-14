/**
 * Lấy sản phẩm phù hợp với tiêu chí từ bot
 * Bot sẽ truyền filters sau khi hiểu sở thích user
 */
export async function getProductRecommendations(pool, {
  categorySlug,
  maxPrice,
  minPrice,
  searchTerm,
  gender,
  excludeProductIds = [],
  limit = 4,
}) {
  const conditions = ['p.is_active = TRUE']
  const params = []
  let idx = 1

  if (categorySlug) {
    conditions.push(`c.slug = $${idx++}`)
    params.push(categorySlug)
  }
  if (gender) {
    // Nếu có gender từ profile/filter, lọc theo category hoặc description (tùy schema, ở đây giả định lọc theo category name chứa gender hoặc description)
    conditions.push(`(c.name ILIKE $${idx} OR p.description ILIKE $${idx})`)
    params.push(gender === 'male' ? '%Nam%' : '%Nữ%')
    idx++
  }
  if (maxPrice) {
    conditions.push(`p.base_price <= $${idx++}`)
    params.push(maxPrice)
  }
  if (minPrice) {
    conditions.push(`p.base_price >= $${idx++}`)
    params.push(minPrice)
  }
  if (searchTerm) {
    conditions.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx})`)
    params.push(`%${searchTerm}%`)
    idx++
  }
  if (excludeProductIds.length > 0) {
    conditions.push(`p.id != ALL($${idx++})`)
    params.push(excludeProductIds)
  }

  params.push(limit)

  const { rows } = await pool.query(`
    SELECT
      p.id,
      p.name,
      p.slug,
      p.base_price    AS "basePrice",
      c.name          AS "categoryName",
      img.url         AS "imageUrl",
      COALESCE(r.avg_rating, 0) AS "avgRating",
      v.id            AS "defaultVariantId"
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT id FROM product_variants
      WHERE product_id = p.id AND stock > 0
      LIMIT 1
    ) v ON TRUE
    LEFT JOIN LATERAL (
      SELECT url FROM product_images
      WHERE product_id = p.id AND is_primary = TRUE
      LIMIT 1
    ) img ON TRUE
    LEFT JOIN LATERAL (
      SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating
      FROM reviews WHERE product_id = p.id
    ) r ON TRUE
    WHERE ${conditions.join(' AND ')}
    ORDER BY 
      (img.url IS NOT NULL) DESC,
      r.avg_rating DESC NULLS LAST,
      RANDOM()
    LIMIT $${idx}
  `, params)

  return rows
}

/**
 * Lấy lịch sử mua hàng để bot hiểu sở thích
 */
export async function getUserPurchaseHistory(pool, userId) {
  const { rows } = await pool.query(`
    SELECT
      p.name,
      p.slug,
      c.name    AS "categoryName",
      co.name   AS "colorName",
      sz.name   AS "sizeName",
      p.id      AS "productId"
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN product_variants pv ON pv.id = oi.variant_id
    JOIN products p ON p.id = pv.product_id
    JOIN categories c ON c.id = p.category_id
    JOIN colors co ON co.id = pv.color_id
    JOIN sizes sz ON sz.id = pv.size_id
    WHERE o.user_id = $1
      AND o.status IN ('completed', 'delivered', 'shipped')
    GROUP BY p.id, p.name, p.slug, c.name, co.name, sz.name
    ORDER BY MAX(o.created_at) DESC
    LIMIT 10
  `, [userId])
  return rows
}
