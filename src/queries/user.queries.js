/**
 * User & refresh-token query functions.
 * All use parameterised placeholders ($1, $2…) — never string concat.
 * Column aliases convert snake_case → camelCase here so callers get clean JS objects.
 */

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * @param {import('pg').Pool} pool
 * @param {string} email
 * @returns {Promise<{id, email, fullName, role, passwordHash, isActive}|null>}
 */
export async function findUserByEmail(pool, email) {
    const { rows } = await pool.query(
        `SELECT id,
                email,
                full_name      AS "fullName",
                role,
                password_hash  AS "passwordHash",
                is_active      AS "isActive"
         FROM   users
         WHERE  email = $1
         LIMIT  1`,
        [email],
    );
    return rows[0] ?? null;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{id, email, fullName, role, createdAt}>}
 */
export async function createUser(pool, { email, passwordHash, fullName, phone }) {
    const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING id,
                   email,
                   full_name   AS "fullName",
                   role,
                   created_at  AS "createdAt"`,
        [email, passwordHash, fullName, phone ?? null],
    );
    return rows[0];
}

/**
 * @param {import('pg').Pool} pool
 * @param {number|string} id
 * @returns {Promise<{id, email, fullName, phone, role, createdAt}|null>}
 */
export async function findUserById(pool, id) {
    const { rows } = await pool.query(
        `SELECT id,
                email,
                full_name   AS "fullName",
                phone,
                role,
                created_at  AS "createdAt"
         FROM   users
         WHERE  id = $1
         LIMIT  1`,
        [id],
    );
    return rows[0] ?? null;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number|string} id
 * @param {{ fullName?: string, phone?: string }} fields
 * @returns {Promise<{id, email, fullName, phone}>}
 */
export async function updateUser(pool, id, { fullName, phone }) {
    const { rows } = await pool.query(
        `UPDATE users
         SET    full_name  = COALESCE($2, full_name),
                phone      = COALESCE($3, phone),
                updated_at = NOW()
         WHERE  id = $1
         RETURNING id,
                   email,
                   full_name  AS "fullName",
                   phone`,
        [id, fullName ?? null, phone ?? null],
    );
    return rows[0];
}

// ── Refresh tokens ────────────────────────────────────────────────────────────

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
export async function saveRefreshToken(pool, { userId, tokenHash, expiresAt }) {
    await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAt],
    );
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tokenHash
 * @returns {Promise<{userId, email, role}|null>}
 */
export async function findRefreshToken(pool, tokenHash) {
    const { rows } = await pool.query(
        `SELECT rt.user_id  AS "userId",
                u.email,
                u.role
         FROM   refresh_tokens rt
         JOIN   users u ON u.id = rt.user_id
         WHERE  rt.token_hash = $1
           AND  rt.expires_at > NOW()
         LIMIT  1`,
        [tokenHash],
    );
    return rows[0] ?? null;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tokenHash
 * @returns {Promise<void>}
 */
export async function deleteRefreshToken(pool, tokenHash) {
    await pool.query(
        `DELETE FROM refresh_tokens WHERE token_hash = $1`,
        [tokenHash],
    );
}

/**
 * @param {import('pg').Pool} pool
 * @param {number|string} userId
 * @returns {Promise<void>}
 */
export async function deleteAllUserTokens(pool, userId) {
    await pool.query(
        `DELETE FROM refresh_tokens WHERE user_id = $1`,
        [userId],
    );
}
