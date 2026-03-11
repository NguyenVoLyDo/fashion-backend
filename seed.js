import pg from 'pg'

const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:zqCPYwElkodlOmkUoJhowbmLQZtwdrcT@metro.proxy.rlwy.net:42822/railway',
})

async function seed() {
  try {
    console.log('Clearing old data...')
    await pool.query(`
      TRUNCATE TABLE 
        product_variants, 
        product_images, 
        products, 
        categories, 
        colors, 
        sizes 
      RESTART IDENTITY CASCADE
    `)

    console.log('Inserting Categories...')
    const { rows: catRows } = await pool.query(
      `INSERT INTO categories (name, slug) VALUES ('Áo Nam', 'ao-nam') RETURNING id`
    )
    const parentId = catRows[0].id
    await pool.query(
      `INSERT INTO categories (name, slug, parent_id) VALUES ('Áo Thun', 'ao-thun', $1)`,
      [parentId]
    )

    console.log('Inserting Colors & Sizes...')
    const { rows: colorRows } = await pool.query(
      `INSERT INTO colors (name, hex) VALUES ('Trắng', '#FFFFFF'), ('Đen', '#000000') RETURNING id`
    )
    const whiteId = colorRows[0].id
    const blackId = colorRows[1].id

    const { rows: sizeRows } = await pool.query(
      `INSERT INTO sizes (name) VALUES ('S'), ('M'), ('L') RETURNING id`
    )
    const sId = sizeRows[0].id
    const mId = sizeRows[1].id

    console.log('Inserting Products...')
    const { rows: prodRows } = await pool.query(
      `INSERT INTO products (category_id, name, slug, description, base_price, is_active)
       VALUES ($1, 'Áo Thun Basic Trắng/Đen', 'ao-thun-basic', 'Áo thun cotton 100% cực mát và thoải mái. Thích hợp mặc hàng ngày.', 150000, TRUE)
       RETURNING id`,
      [parentId]
    )
    const productId = prodRows[0].id

    console.log('Inserting Variants...')
    await pool.query(
      `INSERT INTO product_variants (product_id, color_id, size_id, sku, price, stock)
       VALUES ($1, $2, $3, 'ATBS-W-S', 150000, 100),
              ($1, $2, $4, 'ATBS-W-M', 150000, 50),
              ($1, $5, $3, 'ATBS-B-S', 150000, 20),
              ($1, $5, $4, 'ATBS-B-M', 150000, 0)`,
      [productId, whiteId, sId, mId, blackId]
    )

    console.log('Inserting Images...')
    await pool.query(
      `INSERT INTO product_images (product_id, url, is_primary, sort_order)
       VALUES ($1, 'https://res.cloudinary.com/dkzgxp6wg/image/upload/v1/samples/ecommerce/analog-classic.jpg', TRUE, 1),
              ($1, 'https://res.cloudinary.com/dkzgxp6wg/image/upload/v1/samples/ecommerce/shoes.png', FALSE, 2)`,
      [productId]
    )

    // A second product
    const { rows: prod2Rows } = await pool.query(
      `INSERT INTO products (category_id, name, slug, description, base_price, is_active)
       VALUES ($1, 'Áo Khoác Nam Mùa Đông', 'ao-khoac-nam', 'Áo khoác dù dày dặn, giữ ấm cực tốt. Có mũ trùm tiện lợi.', 450000, TRUE)
       RETURNING id`,
      [parentId]
    )
    const prod2Id = prod2Rows[0].id

    await pool.query(
      `INSERT INTO product_variants (product_id, color_id, size_id, sku, price, stock)
       VALUES ($1, $2, $3, 'AKM-B-L', 450000, 15)`,
      [prod2Id, blackId, sizeRows[2].id]
    )

    await pool.query(
      `INSERT INTO product_images (product_id, url, is_primary, sort_order)
       VALUES ($1, 'https://res.cloudinary.com/dkzgxp6wg/image/upload/v1/samples/ecommerce/car-accessories.jpg', TRUE, 1)`,
      [prod2Id]
    )

    console.log('Seed completed successfully!')
  } catch (error) {
    console.error('Error seeding data:', error)
  } finally {
    pool.end()
  }
}

seed()
