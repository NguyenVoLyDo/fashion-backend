/**
 * Voucher query functions.
 * All DB column names use snake_case; camelCase in responses via SQL aliases.
 */

// ── findVoucherByCode ─────────────────────────────────────────────────────────

/**
 * Find an active voucher by its code (case-insensitive).
 * @returns {object|null}
 */
export async function findVoucherByCode(pool, code) {
    const { rows } = await pool.query(
        `SELECT * FROM vouchers WHERE code = UPPER(TRIM($1)) AND is_active = TRUE`,
        [code],
    );
    return rows[0] ?? null;
}

// ── validateVoucher ───────────────────────────────────────────────────────────

/**
 * Validate a voucher for the given subtotal.
 * Throws descriptive errors for each failure mode.
 *
 * @param {import('pg').Pool} pool
 * @param {{ code: string, subtotal: number }} opts
 * @returns {Promise<object>} Valid voucher row
 */
export async function validateVoucher(pool, { code, subtotal }) {
    const voucher = await findVoucherByCode(pool, code);

    if (!voucher) {
        const err = new Error('Voucher not found');
        err.code = 'VOUCHER_NOT_FOUND';
        err.status = 400;
        throw err;
    }

    const now = new Date();

    if (voucher.valid_from && new Date(voucher.valid_from) > now) {
        const err = new Error('Voucher has not started yet');
        err.code = 'VOUCHER_NOT_STARTED';
        err.status = 400;
        throw err;
    }

    if (voucher.valid_until && new Date(voucher.valid_until) < now) {
        const err = new Error('Voucher has expired');
        err.code = 'VOUCHER_EXPIRED';
        err.status = 400;
        throw err;
    }

    if (voucher.usage_limit !== null && voucher.used_count >= voucher.usage_limit) {
        const err = new Error('Voucher has reached its usage limit');
        err.code = 'VOUCHER_EXHAUSTED';
        err.status = 400;
        throw err;
    }

    const minRequired = Number(voucher.min_order_value ?? 0);
    if (subtotal < minRequired) {
        const err = new Error('Order subtotal does not meet voucher minimum');
        err.code = 'VOUCHER_MIN_NOT_MET';
        err.status = 400;
        err.data = { minRequired, currentSubtotal: subtotal };
        throw err;
    }

    return voucher;
}

// ── calculateDiscount ─────────────────────────────────────────────────────────

/**
 * Calculate the discount amount for a validated voucher.
 * For 'free_ship' type, returns 0 (shipping is handled separately).
 *
 * @param {object} voucher
 * @param {number} subtotal
 * @returns {number} discountAmount
 */
export function calculateDiscount(voucher, subtotal) {
    const value = Number(voucher.value);

    if (voucher.type === 'percent') {
        let discount = subtotal * (value / 100);
        if (voucher.max_discount !== null) {
            discount = Math.min(discount, Number(voucher.max_discount));
        }
        return discount;
    }

    if (voucher.type === 'fixed') {
        return Math.min(value, subtotal); // never negative
    }

    // type === 'free_ship'
    return 0;
}

// ── incrementUsage ────────────────────────────────────────────────────────────

/**
 * Increment a voucher's used_count.
 * Must be called within an active transaction (client passed in).
 *
 * @param {import('pg').PoolClient} client
 * @param {string} voucherId UUID
 */
export async function incrementUsage(client, voucherId) {
    await client.query(
        `UPDATE vouchers SET used_count = used_count + 1 WHERE id = $1`,
        [voucherId],
    );
}

// ── Admin queries ─────────────────────────────────────────────────────────────

export async function createVoucher(pool, data) {
    const { code, type, value, minOrderValue, maxDiscount, usageLimit, validFrom, validUntil } = data;
    const { rows } = await pool.query(`
        INSERT INTO vouchers (code, type, value, min_order_value, max_discount, usage_limit, valid_from, valid_until)
        VALUES (UPPER(TRIM($1)), $2, $3, COALESCE($4, 0), $5, $6, $7, $8)
        RETURNING *
    `, [code, type, value, minOrderValue ?? null, maxDiscount ?? null, usageLimit ?? null, validFrom ?? null, validUntil ?? null]);
    return rows[0];
}

export async function getVouchers(pool) {
    const { rows } = await pool.query(`SELECT * FROM vouchers ORDER BY created_at DESC`);
    return rows;
}

export async function updateVoucher(pool, { id, data }) {
    const { code, type, value, minOrderValue, maxDiscount, usageLimit, validFrom, validUntil, isActive } = data;
    
    // We use COALESCE so if a value is passed as null/undefined, it uses the existing value.
    // However, since some fields CAN be updated to null, a dynamic UPDATE query is usually better, 
    // but COALESCE is requested / simple. Let's do a simple dynamic update or strict COALESCE.
    // The prompt says "COALESCE update".
    const { rows } = await pool.query(`
        UPDATE vouchers
        SET code = UPPER(TRIM(COALESCE($2, code))),
            type = COALESCE($3, type),
            value = COALESCE($4, value),
            min_order_value = COALESCE($5, min_order_value),
            max_discount = COALESCE($6, max_discount),
            usage_limit = COALESCE($7, usage_limit),
            valid_from = COALESCE($8, valid_from),
            valid_until = COALESCE($9, valid_until),
            is_active = COALESCE($10, is_active)
        WHERE id = $1
        RETURNING *
    `, [
        id, 
        code ?? null, 
        type ?? null, 
        value ?? null, 
        minOrderValue ?? null, 
        maxDiscount ?? null, 
        usageLimit ?? null, 
        validFrom ?? null, 
        validUntil ?? null, 
        isActive ?? null
    ]);
    return rows[0];
}

export async function deleteVoucher(pool, id) {
    await pool.query(`
        UPDATE vouchers
        SET is_active = FALSE
        WHERE id = $1
    `, [id]);
}
