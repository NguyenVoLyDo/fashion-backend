/**
 * Tìm hoặc tạo conversation mới
 */
export async function getOrCreateConversation(pool, { userId, sessionId }) {
  if (userId) {
    const { rows } = await pool.query(
      `SELECT id FROM chat_conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    )
    if (rows[0]) return rows[0].id

    const { rows: created } = await pool.query(
      `INSERT INTO chat_conversations (user_id) VALUES ($1) RETURNING id`,
      [userId]
    )
    return created[0].id
  }

  const { rows } = await pool.query(
    `SELECT id FROM chat_conversations
     WHERE session_id = $1
     ORDER BY updated_at DESC LIMIT 1`,
    [sessionId]
  )
  if (rows[0]) return rows[0].id

  const { rows: created } = await pool.query(
    `INSERT INTO chat_conversations (session_id) VALUES ($1) RETURNING id`,
    [sessionId]
  )
  return created[0].id
}

/**
 * Lấy N messages gần nhất của conversation (để làm context)
 */
export async function getRecentMessages(pool, conversationId, limit = 10) {
  const { rows } = await pool.query(
    `SELECT role, content FROM chat_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit]
  )
  return rows.reverse() // chronological order
}

/**
 * Lưu message vào DB
 */
export async function saveMessage(pool, { conversationId, role, content }) {
  await pool.query(
    `INSERT INTO chat_messages (conversation_id, role, content)
     VALUES ($1, $2, $3)`,
    [conversationId, role, content]
  )
  // Cập nhật updated_at của conversation
  await pool.query(
    `UPDATE chat_conversations SET updated_at = now() WHERE id = $1`,
    [conversationId]
  )
}

/**
 * Lấy đơn hàng gần nhất của user để làm context cho bot
 */
export async function getUserOrdersForBot(pool, userId) {
  const { rows } = await pool.query(
    `SELECT
      o.order_no   AS "orderNo",
      o.status,
      o.total,
      o.created_at AS "createdAt",
      json_agg(json_build_object(
        'name', p.name,
        'quantity', oi.quantity,
        'size', s.name,
        'color', c.name
      )) AS items
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN product_variants pv ON pv.id = oi.variant_id
     JOIN products p ON p.id = pv.product_id
     JOIN sizes s ON s.id = pv.size_id
     JOIN colors c ON c.id = pv.color_id
     WHERE o.user_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT 5`,
    [userId]
  )
  return rows
}
