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
  preferredColors = [], // New
  dislikedColors = [],  // New
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
    if (gender === 'male') {
      conditions.push(`(c.name ILIKE '%Nam%' OR p.description ILIKE '%Nam%' OR c.slug ILIKE '%nam%')`)
    } else if (gender === 'female') {
      conditions.push(`(c.name ILIKE '%Nữ%' OR p.description ILIKE '%Nữ%' OR c.slug ILIKE '%nu%' OR c.slug IN ('vay-dam', 'chan-vay'))`)
    }
  }

  conditions.push('v.id IS NOT NULL')
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

  // Handle disliked colors - Hard filter
  if (dislikedColors.length > 0) {
    const dislikedParams = dislikedColors.map(c => `%${c.trim().toLowerCase()}%`)
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM product_variants pv2 
      JOIN colors co2 ON co2.id = pv2.color_id 
      WHERE pv2.product_id = p.id AND (co2.name ILIKE ANY($${idx++}))
    )`)
    params.push(dislikedParams)
  }

  params.push(limit)
  const limitIdx = idx

  // Order with preferred colors priority (soft filter)
  let orderBy = `(img.url IS NOT NULL) DESC, r.avg_rating DESC NULLS LAST`
  
  if (preferredColors.length > 0) {
    const preferredParams = preferredColors.map(c => `%${c.trim().toLowerCase()}%`)
    const prefIdx = idx++
    params.splice(params.length - 1, 0, preferredParams) // insert before limit
    
    orderBy = `
      EXISTS (
        SELECT 1 FROM product_variants pv3 
        JOIN colors co3 ON co3.id = pv3.color_id 
        WHERE pv3.product_id = p.id AND (co3.name ILIKE ANY($${prefIdx}))
      ) DESC,
      ${orderBy}
    `
  }

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
      ${orderBy},
      RANDOM()
    LIMIT $${limitIdx}
  `, params)

  return rows
}

/**
 * Lấy danh sách sản phẩm theo các nhóm để tạo outfit (tops, bottoms, accessories)
 */
export async function getOutfitRecommendation(pool, {
  gender,
  maxPrice,
  excludeProductIds = [],
}) {
  const topSlugs = ['ao-nam', 'ao-thun', 'ao-so-mi', 'ao-nu', 'ao', 'hoodie', 'jacket', 't-shirt', 'shirt'];
  const bottomSlugs = ['quan-jean', 'quan-nam', 'quan-nu', 'quan', 'vay-dam', 'vay', 'chan-vay', 'pants', 'trousers', 'shorts', 'skirts'];
  const accessorySlugs = ['phu-kien', 'tui', 'giay', 'mu', 'kinh', 'that-lung', 'belt', 'bag', 'shoes', 'accessories'];

  const fetchCandidates = async (slugs, groupLimit = 5) => {
    const conditions = ['p.is_active = TRUE', 'v.id IS NOT NULL']
    const params = [slugs]
    let idx = 2

    conditions.push(`c.slug = ANY($1)`)

    if (gender) {
      if (gender === 'male') {
        conditions.push(`(c.name ILIKE '%Nam%' OR p.description ILIKE '%Nam%' OR c.slug ILIKE '%nam%')`)
      } else if (gender === 'female') {
        conditions.push(`(c.name ILIKE '%Nữ%' OR p.description ILIKE '%Nữ%' OR c.slug ILIKE '%nu%' OR c.slug IN ('vay-dam', 'chan-vay'))`)
      }
    }

    if (maxPrice) {
      // Heuristic: mỗi món không nên chiếm quá 80% ngân sách tổng
      const itemMax = maxPrice * 0.8
      conditions.push(`p.base_price <= $${idx++}`)
      params.push(itemMax)
    }

    if (excludeProductIds.length > 0) {
      conditions.push(`p.id != ALL($${idx++})`)
      params.push(excludeProductIds)
    }

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
      ORDER BY (img.url IS NOT NULL) DESC, r.avg_rating DESC NULLS LAST, RANDOM()
      LIMIT $${idx}
    `, [...params, groupLimit])

    return rows
  }

  const [tops, bottoms, accessories] = await Promise.all([
    fetchCandidates(topSlugs),
    fetchCandidates(bottomSlugs),
    fetchCandidates(accessorySlugs)
  ])

  return { tops, bottoms, accessories }
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
