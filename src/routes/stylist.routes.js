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
import { 
  getOrCreateConversation, 
  getRecentMessages, 
  saveMessage 
} from '../queries/chat.queries.js'

const router = Router()

/**
 * Filter out JSON, Chinese, and leaked system instructions
 */
function sanitizeResponse(text) {
  if (!text) return ''
  
  // 1. Remove JSON blocks
  let clean = text.replace(/```json[\s\S]*?```/g, '')
  clean = clean.replace(/\{[\s\S]*?\}/g, '')
  
  // 2. Remove Chinese characters
  clean = clean.replace(/[\u4e00-\u9fa5]/g, '')
  
  // 3. Strip leaked system keywords/artifacts
  const artifacts = [
    /LƯU Ý:/gi,
    /QUY TẮC:/gi,
    /NHIỆM VỤ:/gi,
    /Hãy viết lại câu trả lời sau/gi,
    /CHỈ TRẢ VỀ TEXT/gi,
    /JSON output/gi
  ]
  artifacts.forEach(regex => {
    clean = clean.replace(regex, '')
  })
  
  // 4. Final trim and cleanup
  clean = clean.trim()
  
  // Fallback if empty after cleaning
  if (!clean || clean.length < 5) {
    return "Mình đã tìm được một vài gợi ý tuyệt vời cho bạn bên dưới nhé!"
  }
  
  return clean
}

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

  return `Bạn là chuyên gia tư vấn thời trang (Stylist AI) cho thương hiệu thời trang Việt Nam.
NHIỆM VỤ:
1. Tư vấn phong cách dựa trên thông tin khách hàng và xu hướng hiện nay.
2. ĐỐI VỚI KHÁCH HÀNG ĐÃ CÓ THÔNG TIN (Giới tính, Độ tuổi): KHÔNG ĐƯỢC HỎI LẠI, hãy dùng thông tin đó để tư vấn ngay.
3. LUÔN LUÔN đề xuất ít nhất 2-3 sản phẩm cụ thể từ danh sách "Sản phẩm có sẵn" bên dưới.
4. Trình bày dưới dạng văn bản tiếng Việt tự nhiên, chuyên nghiệp. Không dùng JSON, không dùng tiếng Trung.

Thông tin khách hàng:
- Giới tính: ${gender ? (gender === 'male' ? 'Nam' : 'Nữ') : 'Chưa biết'}
- Độ tuổi: ${age ? `${age} tuổi` : 'Chưa biết'} (Khách sinh năm ${profile?.birthYear || '?'})
${historyContext}

Danh mục sản phẩm có sẵn: ${availableCategories.join(', ')}

QUY TẮC:
- Luôn dùng tiếng Việt, phong cách trẻ trung, sành điệu.
- Xưng "mình", gọi khách là "bạn".
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
    const sessionId = req.sessionId ?? null

    // Lấy hoặc tạo conversation cho Stylist
    const conversationId = await getOrCreateConversation(pool, { userId, sessionId, type: 'stylist' })

    // Load history từ DB (ghi đè lịch sử truyền từ client để đảm bảo 10 message gần nhất)
    const dbHistory = await getRecentMessages(pool, conversationId, 10)

    // Load profile, purchase history + categories
    const [profile, purchaseHistory, { rows: catRows }] = await Promise.all([
      userId ? getUserProfile(pool, userId) : Promise.resolve(null),
      userId ? getUserPurchaseHistory(pool, userId) : Promise.resolve([]),
      pool.query(`SELECT slug FROM categories`),
    ])

    const availableCategories = catRows.map(r => r.slug)
    const excludeIds = purchaseHistory.map(p => p.productId)

    // Lưu message của user vào DB
    await saveMessage(pool, { conversationId, role: 'user', content: message })

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
 
    // Giữ nguyên logic prompt nhưng dùng dbHistory
    const messages = [
      ...dbHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ]

    const raw = await ollamaChat({
      system: buildStylistPrompt(req.user, profile, purchaseHistory, availableCategories) + 
        '\nCHỈ TRẢ VỀ JSON. CẤM TIẾNG TRUNG (NO CHINESE characters).',
      messages,
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

      // Bước 3: Nếu có sản phẩm, gọi AI lần 2 để lồng ghép tên sản phẩm vào reply
      if (products.length > 0) {
        const productListStr = products.map(p => `- ${p.name} (giá: ${Number(p.basePrice).toLocaleString('vi-VN')}₫)`).join('\n')
        const contextualPrompt = `Dưới đây là danh sách sản phẩm thật từ cửa hàng:
${productListStr}

Hãy viết lại câu trả lời sau để giới thiệu khéo léo ít nhất 2 sản phẩm trên (gọi đúng tên sản phẩm). 
Giữ phong cách chuyên nghiệp, thời trang và thân thiện. Không được bịa thêm sản phẩm khác. 
Câu trả lời cũ: "${parsed.reply}"

LƯU Ý: CHỈ TRẢ VỀ TEXT CÂU TRẢ LỜI, KHÔNG GIẢI THÍCH.`

        const refinedReply = await ollamaChat({
          system: buildStylistPrompt(req.user, profile, purchaseHistory, availableCategories) + '\nCHỈ TRẢ VỀ TEXT TIẾNG VIỆT.',
          messages: [
            ...history.slice(-4),
            { role: 'user', content: contextualPrompt }
          ],
          maxTokens: 512
        })
        
        if (refinedReply && refinedReply.trim().length > 10) {
          parsed.reply = sanitizeResponse(refinedReply)
        }
      }
    } else {
      // Nếu không recommend gì cũng phải sanitize reply lần 1
      parsed.reply = sanitizeResponse(parsed.reply || raw)
    }

    // Lưu message bot vào DB
    await saveMessage(pool, { 
      conversationId, 
      role: 'assistant', 
      content: parsed.reply 
    })

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
