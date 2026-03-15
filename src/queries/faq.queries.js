export async function getAllFaqs(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM faqs
     WHERE is_active = true
     ORDER BY category ASC, sort_order ASC, created_at DESC`
  )
  return rows
}

export async function searchFaqs(pool, keyword) {
  const searchTerm = `%${keyword}%`
  const { rows } = await pool.query(
    `SELECT * FROM faqs
     WHERE is_active = true
       AND (question ILIKE $1 OR answer ILIKE $1)
     ORDER BY category ASC, sort_order ASC`
    ,
    [searchTerm]
  )
  return rows
}

export async function createFaq(pool, data) {
  const { question, answer, category, is_active = true, sort_order = 0 } = data
  const { rows } = await pool.query(
    `INSERT INTO faqs (question, answer, category, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [question, answer, category, is_active, sort_order]
  )
  return rows[0]
}

export async function updateFaq(pool, id, data) {
  // Build dynamic update query
  const fields = []
  const values = []
  let paramIdx = 1

  if (data.question !== undefined) {
    fields.push(`question = $${paramIdx++}`)
    values.push(data.question)
  }
  if (data.answer !== undefined) {
    fields.push(`answer = $${paramIdx++}`)
    values.push(data.answer)
  }
  if (data.category !== undefined) {
    fields.push(`category = $${paramIdx++}`)
    values.push(data.category)
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${paramIdx++}`)
    values.push(data.is_active)
  }
  if (data.sort_order !== undefined) {
    fields.push(`sort_order = $${paramIdx++}`)
    values.push(data.sort_order)
  }

  if (fields.length === 0) return null

  fields.push(`updated_at = now()`)
  values.push(id)

  const query = `
    UPDATE faqs
    SET ${fields.join(', ')}
    WHERE id = $${paramIdx}
    RETURNING *
  `

  const { rows } = await pool.query(query, values)
  return rows[0]
}

export async function deleteFaq(pool, id) {
  const { rows } = await pool.query(
    `DELETE FROM faqs WHERE id = $1 RETURNING *`,
    [id]
  )
  return rows[0]
}
