import { Router } from 'express';
import asyncHandler from '../middleware/async-handler.js';
import authMiddleware from '../middleware/auth.js';
import pool from '../config/db.js';
import * as profileQueries from '../queries/profile.queries.js';

const router = Router();

// ── Profile ──────────────────────────────────────────────────────────────────

// GET /profile/me
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = await profileQueries.getUserProfile(pool, req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }
    res.json({ data: user });
  })
);

// PATCH /profile/me
router.patch(
  '/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const updated = await profileQueries.updateUserProfile(pool, req.user.id, req.body);
    res.json({ data: updated });
  })
);

// ── Addresses ────────────────────────────────────────────────────────────────

// GET /profile/addresses
router.get(
  '/addresses',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const addresses = await profileQueries.getUserAddresses(pool, req.user.id);
    res.json({ data: addresses });
  })
);

// POST /profile/addresses
router.post(
  '/addresses',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const address = await profileQueries.createAddress(pool, req.user.id, req.body);
    res.status(201).json({ data: address });
  })
);

// PATCH /profile/addresses/:id
router.patch(
  '/addresses/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const addressId = parseInt(req.params.id);
    const updated = await profileQueries.updateAddress(pool, req.user.id, addressId, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Address not found', code: 'NOT_FOUND' });
    }
    res.json({ data: updated });
  })
);

// DELETE /profile/addresses/:id
router.delete(
  '/addresses/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const addressId = parseInt(req.params.id);
    const success = await profileQueries.deleteAddress(pool, req.user.id, addressId);
    if (!success) {
      return res.status(404).json({ error: 'Address not found or not owned by user', code: 'NOT_FOUND' });
    }
    res.json({ data: { message: 'Address deleted' } });
  })
);

// PATCH /profile/addresses/:id/default
router.patch(
  '/addresses/:id/default',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const addressId = parseInt(req.params.id);
    const updated = await profileQueries.setDefaultAddress(pool, req.user.id, addressId);
    if (!updated) {
      return res.status(404).json({ error: 'Address not found', code: 'NOT_FOUND' });
    }
    res.json({ data: updated });
  })
);

export default router;
