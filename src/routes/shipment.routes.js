import { Router } from 'express';
import { body, validationResult } from 'express-validator';

import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import pool from '../config/db.js';
import { 
    createShipment, 
    getShipmentByOrder, 
    updateShipmentStatus, 
    markOrderDelivered, 
    markOrderShipped 
} from '../queries/shipment.queries.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function validate(req) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const err = new Error('Validation failed');
        err.code = 'BAD_REQUEST';
        err.status = 400;
        err.details = errors.array();
        throw err;
    }
}

/** Middleware: require that the authenticated user has the 'admin' role. */
function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
}

// ── GET /orders/:id/shipment ──────────────────────────────────────────────────

router.get(
    '/orders/:id/shipment',
    authMiddleware,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify order belongs to user
        const { rows } = await pool.query(`SELECT id FROM orders WHERE id = $1 AND user_id = $2`, [id, userId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Order not found', code: 'ORDER_NOT_FOUND' });
        }

        const shipment = await getShipmentByOrder(pool, id);
        if (!shipment) {
            return res.status(404).json({ error: 'Shipment not found', code: 'SHIPMENT_NOT_FOUND' });
        }

        return res.status(200).json({ data: shipment });
    })
);

// ── POST /admin/orders/:id/shipment ───────────────────────────────────────────

router.post(
    '/admin/orders/:id/shipment',
    authMiddleware,
    requireAdmin,
    body('carrier').isString().trim().notEmpty(),
    body('trackingNumber').isString().trim().notEmpty(),
    body('estimatedDelivery').optional().isDate(),
    asyncHandler(async (req, res) => {
        validate(req);
        const { id } = req.params;
        const { carrier, trackingNumber, estimatedDelivery } = req.body;

        const shipment = await createShipment(pool, {
            orderId: id,
            carrier,
            trackingNumber,
            estimatedDelivery
        });

        await markOrderShipped(pool, id);

        return res.status(201).json({ data: shipment });
    })
);

// ── PATCH /admin/shipments/:id/status ─────────────────────────────────────────

router.patch(
    '/admin/shipments/:id/status',
    authMiddleware,
    requireAdmin,
    body('status').isIn(['pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed']),
    body('carrierData').optional().isObject(),
    asyncHandler(async (req, res) => {
        validate(req);
        const { id } = req.params;
        const { status, carrierData } = req.body;

        const shipment = await updateShipmentStatus(pool, {
            shipmentId: id,
            status,
            carrierData
        });

        if (!shipment) {
            return res.status(404).json({ error: 'Shipment not found', code: 'SHIPMENT_NOT_FOUND' });
        }

        if (status === 'delivered') {
            await markOrderDelivered(pool, shipment.order_id);
        }

        return res.status(200).json({ data: shipment });
    })
);

// ── POST /webhooks/ghn ────────────────────────────────────────────────────────

router.post(
    '/webhooks/ghn',
    asyncHandler(async (req, res) => {
        // Body represents GHN structured event log
        const { OrderCode, Status, ...restData } = req.body;
        
        if (!OrderCode || !Status) {
            return res.status(200).json({ message: 'ok' }); // Ignore malformed explicitly ensuring webhooks never retry forever
        }

        // Map GHN status internally
        const lowerStatus = Status.toLowerCase();
        let internalStatus = lowerStatus;
        if (lowerStatus === 'picking') internalStatus = 'picked_up';
        if (lowerStatus === 'delivering') internalStatus = 'in_transit';
        if (lowerStatus === 'cancel') internalStatus = 'failed';

        // Find the shipment natively bridging webhook
        const { rows } = await pool.query(`SELECT id, order_id FROM shipments WHERE tracking_number = $1 LIMIT 1`, [OrderCode]);
        
        // GHN may broadcast webhooks for random scopes, intentionally ignoring unknown refs returning 200 HTTP successfully.
        if (rows.length === 0) {
            return res.status(200).json({ message: 'ok' });
        }

        const shipmentId = rows[0].id;
        const orderId = rows[0].order_id;
        
        await updateShipmentStatus(pool, {
            shipmentId,
            status: internalStatus,
            carrierData: restData
        });

        if (internalStatus === 'delivered') {
            await markOrderDelivered(pool, orderId);
        }

        return res.status(200).json({ message: 'ok' });
    })
);

export default router;
