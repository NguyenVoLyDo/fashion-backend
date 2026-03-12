import { Router } from 'express'
import asyncHandler from '../middleware/async-handler.js'
import optionalAuth from '../middleware/optional-auth.js'
import pool from '../config/db.js'
import { ollamaChat } from '../lib/ollama.js'
import {
  getProductRecommendations,
  getUserPurchaseHistory,
} from '../queries/stylist.queries.js'

const router = Router()

// System prompt cho Stylist Bot
function buildStylistPrompt(user, purchaseHistory, availableCategories) {
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
1. Hỏi 1-2 câu ngắn để hiểu nhu cầu (dịp mặc, phong cách thích, ngân sách)
2. Dựa trên câu trả lời -> Đề xuất sản phẩm phù hợp bằng JSON output
3. Giới thiệu sản phẩm được đề xuất một cách tự nhiên, thời trang

QUY TẮC:
- Luôn dùng tiếng Việt, phong cách trẻ trung, sành điệu
- Xưng "mình", gọi khách là "bạn"
- Không bịa sản phẩm — chỉ giới thiệu sản phẩm thật từ database
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

    // Load purchase history + categories
    const [purchaseHistory, { rows: catRows }] = await Promise.all([
      userId ? getUserPurchaseHistory(pool, userId) : Promise.resolve([]),
      pool.query(`SELECT slug FROM categories`),
    ])

    const availableCategories = catRows.map(r => r.slug)
    const excludeIds = purchaseHistory.map(p => p.productId)

    // Bước 1: Hỏi Qwen để lấy reply + filters
    const intentPrompt = `Tin nhắn của khách: "${message}"

TRẢ VỀ DUY NHẤT JSON THEO CẤU TRÚC SAU. TUYỆT ĐỐI KHÔNG SỬ DỤNG TIẾNG TRUNG (NO CHINESE). CHỈ DÙNG TIẾNG VIỆT:
{
  "reply": "câu trả lời tư vấn bằng tiếng Việt (3-4 câu)",
  "filters": {
    "categorySlug": "chọn 1 trong các giá trị: ${availableCategories.join(', ')} hoặc null",
    "searchTerm": "từ khóa tìm kiếm tiếng Việt hoặc null",
    "maxPrice": số hoặc null,
    "minPrice": số hoặc null,
    "shouldRecommend": true (nếu cần tìm sản phẩm) hoặc false
  }
}`

    const raw = await ollamaChat({
      system: buildStylistPrompt(req.user, purchaseHistory, availableCategories) + 
        '\nCHỈ TRẢ VỀ JSON. KHÔNG GIẢI THÍCH. KHÔNG DÙNG TIẾNG TRUNG.',
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
