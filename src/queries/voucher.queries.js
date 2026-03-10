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
