import { v2 as cloudinary } from 'cloudinary'
import { CloudinaryStorage } from 'multer-storage-cloudinary'
import multer from 'multer'
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } from './env.js'

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key:    CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
})

// Storage cho ảnh sản phẩm
const productStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'fashion-store/products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 1067, crop: 'fill', gravity: 'auto' }],
    // 800×1067 = tỉ lệ 3:4 chuẩn cho ảnh thời trang
  },
})

export const uploadProduct = multer({
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
})

export { cloudinary }
