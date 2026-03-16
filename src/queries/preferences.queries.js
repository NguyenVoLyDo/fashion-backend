export async function getUserPreferences(pool, userId) {
  const { rows } = await pool.query(
    'SELECT key, value, confidence, source FROM user_style_preferences WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return rows;
}

export async function upsertPreference(pool, userId, key, value, source = 'inferred') {
  const { rows } = await pool.query(
    `INSERT INTO user_style_preferences (user_id, key, value, source, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, key) 
     DO UPDATE SET value = $3, source = $4, updated_at = now()
     RETURNING *`,
    [userId, key, value, source]
  );
  return rows[0];
}

export async function upsertPreferences(pool, userId, preferences) {
  if (!preferences || !preferences.length) return [];
  
  const results = [];
  for (const pref of preferences) {
    const res = await upsertPreference(pool, userId, pref.key, pref.value, pref.source);
    results.push(res);
  }
  return results;
}

export async function deletePreference(pool, userId, key) {
  const { rowCount } = await pool.query(
    'DELETE FROM user_style_preferences WHERE user_id = $1 AND key = $2',
    [userId, key]
  );
  return rowCount > 0;
}

export async function deleteAllPreferences(pool, userId) {
  const { rowCount } = await pool.query(
    'DELETE FROM user_style_preferences WHERE user_id = $1',
    [userId]
  );
  return rowCount > 0;
}
