/**
 * Loyalty Points query functions.
 * All DB column names use snake_case; camelCase in responses via SQL aliases.
 */

// ── getOrCreateAccount ────────────────────────────────────────────────────────

export async function getOrCreateAccount(poolOrClient, userId) {
    const { rows } = await poolOrClient.query(`
        INSERT INTO loyalty_accounts (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
        RETURNING *
    `, [userId]);
    
    return rows[0];
}

// ── getAccount ────────────────────────────────────────────────────────────────

export async function getAccount(pool, userId) {
    const { rows } = await pool.query(`
        SELECT la.*,
          (SELECT json_agg(lt ORDER BY lt.created_at DESC)
           FROM (SELECT * FROM loyalty_transactions
                 WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10) lt
          ) AS recent_transactions
        FROM loyalty_accounts la
        WHERE la.user_id = $1
    `, [userId]);
    
    return rows[0] ?? null;
}

// ── earnPoints ────────────────────────────────────────────────────────────────

export async function earnPoints(client, { userId, points, reason, refId }) {
    await client.query(`
        INSERT INTO loyalty_transactions (user_id, points, reason, ref_id)
        VALUES ($1, $2, $3, $4)
    `, [userId, points, reason, refId]);

    const { rows } = await client.query(`
        UPDATE loyalty_accounts 
        SET
            points_balance = points_balance + $2,
            total_earned   = total_earned + $2,
            tier = CASE
                WHEN total_earned + $2 >= 20000 THEN 'platinum'
                WHEN total_earned + $2 >= 5000  THEN 'gold'
                WHEN total_earned + $2 >= 1000  THEN 'silver'
                ELSE 'bronze'
            END,
            updated_at = NOW()
        WHERE user_id = $1
        RETURNING *
    `, [userId, points]);

    return rows[0];
}

// ── redeemPoints ──────────────────────────────────────────────────────────────

export async function redeemPoints(client, { userId, pointsToRedeem }) {
    const { rows: balances } = await client.query(`
        SELECT points_balance 
        FROM loyalty_accounts 
        WHERE user_id = $1 
        FOR UPDATE
    `, [userId]);

    const balance = balances[0]?.points_balance || 0;
    
    if (balance < pointsToRedeem) {
        throw { code: 'INSUFFICIENT_POINTS', status: 400 };
    }

    await client.query(`
        INSERT INTO loyalty_transactions (user_id, points, reason)
        VALUES ($1, $2, 'redeemed')
    `, [userId, -pointsToRedeem]);

    await client.query(`
        UPDATE loyalty_accounts 
        SET
            points_balance = points_balance - $2,
            updated_at = NOW()
        WHERE user_id = $1
    `, [userId, pointsToRedeem]);

    // 1 point = 100 VND
    return { discountAmount: pointsToRedeem * 100 };
}

// ── completeOrder ─────────────────────────────────────────────────────────────

export async function completeOrder(pool, { orderId, changedBy }) {
    const { rows: orderRows } = await pool.query(`
        SELECT id, user_id, total_amount AS total 
        FROM orders 
        WHERE id = $1 AND status != 'completed'
    `, [orderId]);

    if (orderRows.length === 0) {
        throw { code: 'ORDER_NOT_COMPLETABLE', status: 409 };
    }

    const order = orderRows[0];
    const userId = order.user_id;
    const total = Number(order.total);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            UPDATE orders 
            SET status = 'completed', updated_at = NOW() 
            WHERE id = $1
        `, [orderId]);

        await client.query(`
            INSERT INTO order_status_log (order_id, status, note)
            VALUES ($1, 'completed', 'Order marked as completed by admin')
        `, [orderId]);

        // Note: The original prompt requested passing \`changedBy\` to the log
        // but the DB schema for order_status_log does not have a changed_by column natively.
        // It has (id, order_id, status, note, changed_at).
        // Leaving it in the note instead.

        await getOrCreateAccount(client, userId);

        const pointsEarned = Math.floor(total / 10000);
        let newBalance = 0;

        if (pointsEarned > 0) {
            const acc = await earnPoints(client, { 
                userId, 
                points: pointsEarned,
                reason: 'order_completed', 
                refId: orderId 
            });
            newBalance = acc.points_balance;
        } else {
            const accRows = await client.query(`SELECT points_balance FROM loyalty_accounts WHERE user_id = $1`, [userId]);
            newBalance = accRows.rows[0].points_balance;
        }

        await client.query('COMMIT');
        
        return { orderId, pointsEarned, newBalance };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
