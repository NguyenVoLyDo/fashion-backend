/**
 * Shipment query functions.
 * All DB column names use snake_case; camelCase in responses via SQL aliases.
 */

// ── createShipment ────────────────────────────────────────────────────────────

export async function createShipment(pool, { orderId, carrier, trackingNumber, estimatedDelivery }) {
    const { rows } = await pool.query(`
        INSERT INTO shipments (order_id, carrier, tracking_number, estimated_delivery)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `, [orderId, carrier || null, trackingNumber || null, estimatedDelivery || null]);
    
    return rows[0];
}

// ── getShipmentByOrder ────────────────────────────────────────────────────────

export async function getShipmentByOrder(pool, orderId) {
    const { rows } = await pool.query(`
        SELECT * 
        FROM shipments 
        WHERE order_id = $1
        ORDER BY created_at DESC 
        LIMIT 1
    `, [orderId]);
    
    return rows[0] ?? null;
}

// ── updateShipmentStatus ──────────────────────────────────────────────────────

export async function updateShipmentStatus(pool, { shipmentId, status, carrierData }) {
    const { rows } = await pool.query(`
        UPDATE shipments 
        SET
            status = $2::varchar,
            carrier_data = COALESCE($3, carrier_data),
            delivered_at = CASE WHEN $2::varchar = 'delivered' THEN NOW() ELSE delivered_at END,
            shipped_at   = CASE WHEN $2::varchar = 'picked_up'  THEN NOW() ELSE shipped_at   END,
            updated_at   = NOW()
        WHERE id = $1
        RETURNING *
    `, [shipmentId, status, carrierData ? JSON.stringify(carrierData) : null]);
    
    return rows[0] ?? null;
}

// ── markOrderDelivered ────────────────────────────────────────────────────────

export async function markOrderDelivered(pool, orderId) {
    const { rows } = await pool.query(`
        UPDATE orders 
        SET status = 'delivered', updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [orderId]);
    
    return rows[0] ?? null;
}

// ── markOrderShipped ──────────────────────────────────────────────────────────

export async function markOrderShipped(pool, orderId) {
    const { rows } = await pool.query(`
        UPDATE orders 
        SET status = 'shipped', updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [orderId]);
    
    return rows[0] ?? null;
}
