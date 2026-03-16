import { Router } from 'express'
import { uploadProduct, cloudinary } from '../config/cloudinary.js'
import authMiddleware from '../middleware/auth.js'
import adminMiddleware from '../middleware/admin.js'
import asyncHandler from '../middleware/async-handler.js'

const router = Router()

// POST /upload/product — upload 1 ảnh sản phẩm
// Response: { data: { url, publicId, width, height } }
router.post(
  '/upload/product',
  authMiddleware,
  uploadProduct.single('image'),   // field name: "image"
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Không có file', code: 'NO_FILE' })
    }
    res.status(201).json({
      data: {
        url:      req.file.path,        // Cloudinary URL
        publicId: req.file.filename,    // để delete sau này
        width:    req.file.width,
        height:   req.file.height,
      }
    })
  })
)

// POST /upload/products/bulk — upload nhiều ảnh (max 5)
router.post(
  '/upload/products/bulk',
  authMiddleware,
  adminMiddleware,
  uploadProduct.array('images', 5),
  asyncHandler(async (req, res) => {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'Không có file', code: 'NO_FILE' })
    }
    const uploaded = req.files.map(f => ({
      url:      f.path,
      publicId: f.filename,
    }))
    res.status(201).json({ data: uploaded })
  })
)

// DELETE /upload/product/:publicId — xóa ảnh khỏi Cloudinary
router.delete(
  '/upload/product/:publicId',
  authMiddleware,
  adminMiddleware,
  asyncHandler(async (req, res) => {
    // publicId có thể có dấu / nên cần encode
    const publicId = decodeURIComponent(req.params.publicId)
    await cloudinary.uploader.destroy(publicId)
    res.json({ data: { deleted: true } })
  })
)

export default router
