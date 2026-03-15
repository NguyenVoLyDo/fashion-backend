import { Router } from 'express'
import { body, query } from 'express-validator'
import { validationResult } from 'express-validator'

import asyncHandler from '../middleware/async-handler.js'
import authMiddleware from '../middleware/auth.js'
import adminMiddleware from '../middleware/admin.js'
import pool from '../config/db.js'

import {
  getAllFaqs,
  searchFaqs,
  createFaq,
  updateFaq,
  deleteFaq
} from '../queries/faq.queries.js'

const router = Router()

function validate(req) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    const err = new Error('Validation failed')
    err.code = 'BAD_REQUEST'
    err.status = 400
    err.details = errors.array()
    throw err
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const rows = await getAllFaqs(pool)
  return res.status(200).json({ data: rows })
}))

router.get('/search', query('q').notEmpty().withMessage('Query is required'), asyncHandler(async (req, res) => {
  validate(req)
  const rows = await searchFaqs(pool, req.query.q)
  return res.status(200).json({ data: rows })
}))

router.post('/admin',
  authMiddleware,
  adminMiddleware,
  body('question').notEmpty().trim(),
  body('answer').notEmpty().trim(),
  body('category').notEmpty().trim(),
  body('is_active').optional().isBoolean(),
  body('sort_order').optional().isInt(),
  asyncHandler(async (req, res) => {
    validate(req)
    const faq = await createFaq(pool, req.body)
    return res.status(201).json({ data: faq })
  })
)

router.patch('/admin/:id',
  authMiddleware,
  adminMiddleware,
  body('question').optional().trim(),
  body('answer').optional().trim(),
  body('category').optional().trim(),
  body('is_active').optional().isBoolean(),
  body('sort_order').optional().isInt(),
  asyncHandler(async (req, res) => {
    validate(req)
    const faq = await updateFaq(pool, req.params.id, req.body)
    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found', code: 'NOT_FOUND' })
    }
    return res.status(200).json({ data: faq })
  })
)

router.delete('/admin/:id',
  authMiddleware,
  adminMiddleware,
  asyncHandler(async (req, res) => {
    const faq = await deleteFaq(pool, req.params.id)
    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found', code: 'NOT_FOUND' })
    }
    return res.status(200).json({ data: faq })
  })
)

export default router
