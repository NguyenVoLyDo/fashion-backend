/**
 * Lấy thông tin profile đầy đủ
 */
export async function getUserProfile(pool, userId) {
  const { rows } = await pool.query(
    `SELECT 
      id, 
      email, 
      full_name AS "fullName", 
      gender, 
      birth_year AS "birthYear", 
      phone, 
      avatar_url AS "avatarUrl", 
      created_at AS "createdAt"
     FROM users 
     WHERE id = $1`,
    [userId]
  );
  return rows[0];
}

/**
 * Cập nhật profile user
 */
export async function updateUserProfile(pool, userId, data) {
  const { fullName, phone, gender, birthYear, avatarUrl } = data;
  const { rows } = await pool.query(
    `UPDATE users 
     SET 
      full_name = COALESCE($2, full_name),
      phone = COALESCE($3, phone),
      gender = COALESCE($4, gender),
      birth_year = COALESCE($5, birth_year),
      avatar_url = COALESCE($6, avatar_url),
      updated_at = NOW()
     WHERE id = $1
     RETURNING id, full_name AS "fullName", phone, gender, birth_year AS "birthYear", avatar_url AS "avatarUrl"`,
    [userId, fullName, phone, gender, birthYear, avatarUrl]
  );
  return rows[0];
}

/**
 * Lấy tất cả địa chỉ của user, địa chỉ mặc định lên đầu
 */
export async function getUserAddresses(pool, userId) {
  const { rows } = await pool.query(
    `SELECT 
      id, 
      full_name AS "fullName", 
      phone, 
      province, 
      district, 
      ward, 
      address_line AS "addressLine", 
      is_default AS "isDefault", 
      created_at AS "createdAt"
     FROM addresses 
     WHERE user_id = $1 
     ORDER BY is_default DESC, created_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * Thêm địa chỉ mới
 */
export async function createAddress(pool, userId, data) {
  const { fullName, phone, province, district, ward, addressLine, isDefault } = data;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (isDefault) {
      await client.query(
        `UPDATE addresses SET is_default = FALSE WHERE user_id = $1`,
        [userId]
      );
    }
    
    const { rows } = await client.query(
      `INSERT INTO addresses (user_id, full_name, phone, province, district, ward, address_line, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, full_name AS "fullName", phone, province, district, ward, address_line AS "addressLine", is_default AS "isDefault"`,
      [userId, fullName, phone, province, district, ward, addressLine, isDefault || false]
    );
    
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Cập nhật địa chỉ
 */
export async function updateAddress(pool, userId, addressId, data) {
  const { fullName, phone, province, district, ward, addressLine, isDefault } = data;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (isDefault) {
      await client.query(
        `UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND id != $2`,
        [userId, addressId]
      );
    }
    
    const { rows } = await client.query(
      `UPDATE addresses 
       SET 
        full_name = COALESCE($3, full_name),
        phone = COALESCE($4, phone),
        province = COALESCE($5, province),
        district = COALESCE($6, district),
        ward = COALESCE($7, ward),
        address_line = COALESCE($8, address_line),
        is_default = COALESCE($9, is_default)
       WHERE id = $1 AND user_id = $2
       RETURNING id, full_name AS "fullName", phone, province, district, ward, address_line AS "addressLine", is_default AS "isDefault"`,
      [addressId, userId, fullName, phone, province, district, ward, addressLine, isDefault]
    );
    
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Xóa địa chỉ
 */
export async function deleteAddress(pool, userId, addressId) {
  const { rowCount } = await pool.query(
    `DELETE FROM addresses WHERE id = $1 AND user_id = $2`,
    [addressId, userId]
  );
  return rowCount > 0;
}

/**
 * Đặt địa chỉ mặc định
 */
export async function setDefaultAddress(pool, userId, addressId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(
      `UPDATE addresses SET is_default = FALSE WHERE user_id = $1`,
      [userId]
    );
    
    const { rows } = await client.query(
      `UPDATE addresses SET is_default = TRUE WHERE id = $1 AND user_id = $2
       RETURNING id, full_name AS "fullName", is_default AS "isDefault"`,
      [addressId, userId]
    );
    
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
