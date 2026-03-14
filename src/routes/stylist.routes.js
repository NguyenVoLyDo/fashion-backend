import { Router } from 'express'
import asyncHandler from '../middleware/async-handler.js'
import optionalAuth from '../middleware/optional-auth.js'
import pool from '../config/db.js'
import { ollamaChat } from '../lib/ollama.js'
import {
  getProductRecommendations,
  getUserPurchaseHistory,
} from '../queries/stylist.queries.js'
import { getUserProfile } from '../queries/profile.queries.js'

const router = Router()

// System prompt cho Stylist Bot
function buildStylistPrompt(user, profile, purchaseHistory, availableCategories) {
  const age = profile?.birthYear ? (new Date().getFullYear() - profile.birthYear) : null;
  const gender = profile?.gender || null;

  const profileCtx = age || gender
    ? `\nThông tin khách hàng: ${gender ? `Giới tính ${gender === 'male' ? 'Nam' : 'Nữ'}` : ''}${age ? `, ${age} tuổi` : ''}.`
    : '\nThông tin khách hàng: Chưa có thông tin về tuổi và giới tính. Hãy hỏi khéo léo nếu cần.'

  const historyContext = purchaseHistory.length > 0
    ? `\nLịch sử mua hàng của khách:
${purchaseHistory.map(p =>
  `- ${p.name} (${p.categoryName}, màu ${p.colorName}, size ${p.sizeName})`
).join('\n')}`
    : '\nKhách chưa có lịch sử mua hàng.'

  const userCtx = user
    ? `\nKhách hàng: ${user.fullName || user.email}`
    : '\nKhách chưa đăng nhập.'

  return `Bạn là Fashion Stylist AI của Fashion Store — chuyên tư vấn phong cách và đề xuất sản phẩm.
${userCtx}
${historyContext}

Danh mục sản phẩm có sẵn: ${availableCategories.join(', ')}

NHIỆM VỤ:
1. Phân tích phong cách phù hợp dựa trên độ tuổi (${age || 'chưa rõ'}) và giới tính (${gender || 'chưa rõ'}).
2. Hỏi 1-2 câu ngắn để hiểu thêm nhu cầu (dịp mặc, sở thích, ngân sách).
3. Đề xuất sản phẩm phù hợp bằng JSON output. Ưu tiên sản phẩm nam cho khách nam, nữ cho khách nữ. Nếu tuổi trẻ (dưới 30) -> phong cách năng động, trendy. Nếu trên 30 -> phong cách thanh lịch, công sở.
4. Giới thiệu sản phẩm một cách tự nhiên, thời trang.

QUY TẮC:
- Luôn dùng tiếng Việt, phong cách trẻ trung, sành điệu.
- Xưng "mình", gọi khách là "bạn".
- Nếu chưa có thông tin giới tính/tuổi -> hãy hỏi khách thay vì tự đoán.
- Không bịa sản phẩm — chỉ giới thiệu sản phẩm thật từ database.
- Trả về kết quả dưới dạng JSON có cấu trúc.`
}

// POST /stylist/chat
router.post(
  '/chat',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { message, history = [] } = req.body

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required', code: 'NO_MESSAGE' })
    }

    const userId = req.user?.id ?? null

    // Load profile, purchase history + categories
    const [profile, purchaseHistory, { rows: catRows }] = await Promise.all([
      userId ? getUserProfile(pool, userId) : Promise.resolve(null),
      userId ? getUserPurchaseHistory(pool, userId) : Promise.resolve([]),
      pool.query(`SELECT slug FROM categories`),
    ])

    const availableCategories = catRows.map(r => r.slug)
    const excludeIds = purchaseHistory.map(p => p.productId)

    // Bước 1: Hỏi Qwen để lấy reply + filters
    const intentPrompt = `Dưới đây là một số ví dụ về cách phản hồi:

VÍ DỤ 1:
Khách: "Tôi muốn tìm áo sơ mi đi làm"
Phản hồi: {
  "reply": "Chào bạn! Một chiếc áo sơ mi chỉnh chu sẽ giúp bạn tự tin hơn rất nhiều ở công sở. Mình có một vài mẫu sơ mi vải linen thoáng mát hoặc cotton cao cấp rất hợp với bạn đó.",
  "filters": {
    "categorySlug": "ao-so-mi",
    "searchTerm": "sơ mi",
    "maxPrice": null,
    "minPrice": null,
    "shouldRecommend": true
  }
}

VÍ DỤ 2:
Khách: "Chào bạn"
Phản hồi: {
  "reply": "Chào bạn! Mình là Stylist AI của Fashion Store đây. Hôm nay mình có thể giúp gì cho bạn trong việc chọn đồ không nhỉ?",
  "filters": {
    "categorySlug": null,
    "searchTerm": null,
    "maxPrice": null,
    "minPrice": null,
    "shouldRecommend": false
  }
}

Dựa trên các ví dụ trên, hãy xử lý tin nhắn sau. 
LƯU Ý: CHỈ TRẢ VỀ JSON. TUYỆT ĐỐI KHÔNG DÙNG TIẾNG TRUNG. KHÔNG GIẢI THÍCH THÊM.

Tin nhắn của khách: "${message}"`

    const raw = await ollamaChat({
      system: buildStylistPrompt(req.user, profile, purchaseHistory, availableCategories) + 
        '\nCHỈ TRẢ VỀ JSON. CẤM TIẾNG TRUNG (NO CHINESE characters).',
      messages: [
        ...history.slice(-6),
        { role: 'user', content: intentPrompt },
      ],
      maxTokens: 512,
    })

    // Parse JSON — Ollama đôi khi wrap trong ```json ... ```
    let parsed = { reply: raw, filters: { shouldRecommend: false } }
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        parsed = JSON.parse(match[0])
        // Đảm bảo categorySlug hợp lệ
        if (parsed.filters?.categorySlug && !availableCategories.includes(parsed.filters.categorySlug)) {
          parsed.filters.categorySlug = null
        }
      }
    } catch {
      // fallback: dùng raw text
    }

    // Bước 2: Fetch sản phẩm nếu cần
    let products = []
    if (parsed.filters?.shouldRecommend) {
      products = await getProductRecommendations(pool, {
        categorySlug: parsed.filters.categorySlug || undefined,
        searchTerm: parsed.filters.searchTerm || undefined,
        maxPrice: parsed.filters.maxPrice || undefined,
        minPrice: parsed.filters.minPrice || undefined,
        excludeProductIds: excludeIds,
        limit: 4,
      })
    }

    // SSE streaming (dùng đồng nhất với Support Bot cho frontend)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    // Gửi response
    res.write(`data: ${JSON.stringify({
      type: 'response',
      text: parsed.reply || raw,
      products,
    })}\n\n`)

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  })
)

export default router
