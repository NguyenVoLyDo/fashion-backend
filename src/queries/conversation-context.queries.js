/**
 * Conversation Context Queries
 * Manages structured chat-level context for the Stylist Bot
 */

export async function getContext(pool, conversationId) {
  const result = await pool.query(
    'SELECT * FROM conversation_context WHERE conversation_id = $1',
    [conversationId]
  )
  return result.rows[0] || null
}

export async function upsertContext(pool, conversationId, updates) {
  const current = await getContext(pool, conversationId)
  
  if (!current) {
    // Create new
    const keys = ['conversation_id', ...Object.keys(updates)]
    const values = [conversationId, ...Object.values(updates)]
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
    
    await pool.query(
      `INSERT INTO conversation_context (${keys.join(', ')}) VALUES (${placeholders})`,
      values
    )
  } else {
    // Merge updates (only non-null fields)
    const setClauses = []
    const values = [conversationId]
    let paramIdx = 2
    
    for (const [key, value] of Object.entries(updates)) {
      if (value !== null && value !== undefined) {
        if (['excluded_product_ids', 'liked_product_ids', 'disliked_product_ids', 'disliked_reasons'].includes(key)) {
          // Special case: append to array
          setClauses.push(`${key} = ARRAY(SELECT DISTINCT UNNEST(ARRAY_CAT(${key}, $${paramIdx})))`)
        } else {
          setClauses.push(`${key} = $${paramIdx}`)
        }
        values.push(value)
        paramIdx++
      }
    }
    
    if (setClauses.length > 0) {
      setClauses.push('updated_at = NOW()')
      await pool.query(
        `UPDATE conversation_context SET ${setClauses.join(', ')} WHERE conversation_id = $1`,
        values
      )
    }
  }
  
  return getContext(pool, conversationId)
}

/**
 * Move products from excluded (suggested) to disliked
 */
export async function moveExcludedToDisliked(pool, conversationId, reason = null) {
  const current = await getContext(pool, conversationId)
  if (!current || !current.excluded_product_ids || current.excluded_product_ids.length === 0) return null

  const productIds = current.excluded_product_ids
  const reasons = productIds.map(() => reason || 'No specific reason')

  await pool.query(
    `UPDATE conversation_context SET 
      disliked_product_ids = ARRAY(SELECT DISTINCT UNNEST(ARRAY_CAT(disliked_product_ids, $2))),
      disliked_reasons = disliked_reasons || $3,
      excluded_product_ids = '{}',
      updated_at = NOW()
     WHERE conversation_id = $1`,
    [conversationId, productIds, reasons]
  )
  
  return getContext(pool, conversationId)
}

export async function appendExcludedProducts(pool, conversationId, productIds) {
  if (!productIds || productIds.length === 0) return
  
  await pool.query(
    `INSERT INTO conversation_context (conversation_id, excluded_product_ids)
     VALUES ($1, $2)
     ON CONFLICT (conversation_id) DO UPDATE SET
     excluded_product_ids = ARRAY(SELECT DISTINCT UNNEST(ARRAY_CAT(conversation_context.excluded_product_ids, $2))),
     updated_at = NOW()`,
    [conversationId, productIds]
  )
}

export async function resetContext(pool, conversationId) {
  await pool.query(
    `UPDATE conversation_context SET 
      gender = NULL, 
      occasion = NULL, 
      style = NULL, 
      max_price = NULL, 
      min_price = NULL, 
      excluded_product_ids = '{}',
      disliked_product_ids = '{}',
      disliked_reasons = '{}',
      liked_product_ids = '{}',
      recipient = NULL,
      target_gender = NULL,
      updated_at = NOW()
     WHERE conversation_id = $1`,
    [conversationId]
  )
}
