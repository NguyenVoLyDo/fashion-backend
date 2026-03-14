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

// System prompt cho Stylist Bot - NÂNG CẤP ĐA BƯỚC
function buildStylistPrompt(user, profile, purchaseHistory, availableCategories) {
  const age = profile?.birthYear ? (new Date().getFullYear() - profile.birthYear) : null;
  const gender = profile?.gender || null;

  const profileCtx = age || gender
    ? `\nThông tin khách hàng: ${gender ? `Giới tính ${gender === 'male' ? 'Nam' : 'Nữ'}` : ''}${age ? `, ${age} tuổi` : ''}.`
    : '\nThông tin khách hàng: Chưa có thông tin về tuổi và giới tính. Hãy hỏi khéo léo nếu cần.'

  const currentInfoCtx = `\nTRẠNG THÁI THU THẬP THÔNG TIN HIỆN TẠI (ĐỪNG HỎI LẠI CÁI ĐÃ CÓ):
- Dịp mặc: ${profile?.collectedInfo?.occasion || 'Chưa biết'}
- Phong cách: ${profile?.collectedInfo?.style || 'Chưa biết'}
- Ngân sách: ${profile?.collectedInfo?.budget || 'Chưa biết'}`

  const historyContext = purchaseHistory.length > 0
    ? `\nLịch sử mua hàng của khách:
${purchaseHistory.map(p =>
  `- ${p.name} (${p.categoryName}, màu ${p.colorName}, size ${p.sizeName})`
).join('\n')}`
    : '\nKhách chưa có lịch sử mua hàng.'

  return `Bạn là Chuyên gia tư vấn thời trang cá nhân (Personal Stylist) cho thương hiệu thời trang Việt Nam.

NHIỆM VỤ:
1. Tư vấn phong cách dựa trên nhu cầu của khách hàng.
2. QUY TRÌNH HỎI: Bạn cần 3 thông tin: Dịp mặc (occasion), Phong cách (style), Ngân sách (budget).
3. LUẬT HỎI TRỰC TIẾP (QUAN TRỌNG):
   - Nếu đã biết "Dịp mặc" và "Phong cách" nhưng thiếu "Ngân sách": Hãy hỏi THẲNG vào ngân sách. Ví dụ: "Ngân sách dự kiến của bạn khoảng bao nhiêu để mình chọn đồ phù hợp?"
   - KHÔNG hỏi xác nhận lại cái khách đã nói (Ví dụ: khách nói "đi làm" thì KHÔNG được hỏi "Bạn tìm đồ đi làm hả?").
   - Mỗi lần chỉ hỏi MỘT câu ngắn dưới 20 từ.
4. KHI NÀO GỢI Ý (QUY TẮC CỨNG): 
   - Nếu đã có thông tin "Ngân sách": BẮT BUỘC set shouldRecommend = true và shouldAskMore = false ngay lập tức.
   - HOẶC khi đã trao đổi qua lại 3 lượt (theo history).
   - KHÔNG ĐƯỢC HỎI LẠI khi đã có đủ Dịp, Phong cách, Ngân sách.

THÔNG TIN ĐÃ BIẾT:
- Giới tính: ${gender ? (gender === 'male' ? 'Nam' : 'Nữ') : 'Chưa biết'}
- Độ tuổi: ${age ? `${age} tuổi` : 'Chưa biết'}${currentInfoCtx}
${historyContext}

Danh mục sản phẩm: ${availableCategories.join(', ')}

PHẢI TRẢ VỀ DẠNG JSON với schema sau:
{
  "reply": "câu trả lời hoặc câu hỏi của bạn",
  "shouldAskMore": boolean, // true nếu cần hỏi thêm
  "collectedInfo": {
    "occasion": "...", // đi làm / dạo phố / sự kiện / null
    "style": "...", // tối giản / thanh lịch / năng động / null
    "budget": number | null // ngân sách tối đa
  },
  "filters": {
    "categorySlug": "...", // slug danh mục phù hợp nhất
    "maxPrice": number | null,
    "minPrice": number | null,
    "shouldRecommend": boolean // true nếu sẵn sàng gợi ý sản phẩm
  }
}

QUY TẮC:
- Xưng "mình", gọi khách là "bạn".
- TUYỆT ĐỐI KHÔNG hỏi lại thông tin đã có trong mục "TRẠNG THÁP THU THẬP THÔNG TIN HIỆN TẠI".
- Nếu khách đã cung cấp thông tin mới trong tin nhắn vừa rồi, hãy cập nhật vào "collectedInfo".
- CHỈ TRẢ VỀ JSON.`
}

// POST /stylist/chat
router.post(
  '/chat',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { message, collectedInfo = {} } = req.body

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required', code: 'NO_MESSAGE' })
    }

    const userId = req.user?.id ?? null
    const sessionId = req.sessionId ?? null

    const conversationId = await getOrCreateConversation(pool, { userId, sessionId, type: 'stylist' })
    const dbHistory = await getRecentMessages(pool, conversationId, 10)

    const [profile, purchaseHistory, { rows: catRows }] = await Promise.all([
      userId ? getUserProfile(pool, userId) : Promise.resolve(null),
      userId ? getUserPurchaseHistory(pool, userId) : Promise.resolve([]),
      pool.query(`SELECT slug FROM categories`),
    ])

    const availableCategories = catRows.map(r => r.slug)
    const excludeIds = purchaseHistory.map(p => p.productId)

    await saveMessage(pool, { conversationId, role: 'user', content: message })

    const messages = [
      ...dbHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ]

    const raw = await ollamaChat({
      system: buildStylistPrompt(req.user, { ...profile, collectedInfo }, purchaseHistory, availableCategories),
      messages,
      maxTokens: 512,
      temperature: 0.5 // Tăng độ sáng tạo cho Stylist
    })

    // Parse JSON
    let parsed = { 
      reply: raw, 
      shouldAskMore: true,
      filters: { shouldRecommend: false } 
    }
    
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const p = JSON.parse(match[0])
        parsed = { ...parsed, ...p }
        
        // Validation
        if (parsed.filters?.categorySlug && !availableCategories.includes(parsed.filters.categorySlug)) {
          parsed.filters.categorySlug = null
        }
      }
    } catch (e) {
      console.error('Stylist JSON Parse Error:', e)
      parsed.reply = sanitizeResponse(raw)
    }

    // Fetch sản phẩm nếu đủ điều kiện
    let products = []
    if (parsed.filters?.shouldRecommend && !parsed.shouldAskMore) {
      products = await getProductRecommendations(pool, {
        categorySlug: parsed.filters.categorySlug || undefined,
        maxPrice: parsed.filters.maxPrice || undefined,
        minPrice: parsed.filters.minPrice || undefined,
        gender: profile?.gender || undefined,
        excludeProductIds: excludeIds,
        limit: 4,
      })

      if (products.length > 0) {
        const productListStr = products.map(p => `- ${p.name} (giá: ${Number(p.basePrice).toLocaleString('vi-VN')}₫)`).join('\n')
        const contextualPrompt = `Dưới đây là danh sách sản phẩm thật từ cửa hàng:
${productListStr}

Hãy viết lại câu trả lời sau để giới thiệu khéo léo ít nhất 2 sản phẩm trên. 
Giữ phong cách chuyên nghiệp, thời trang và thân thiện. Không được bịa thêm sản phẩm khác. 
Câu trả lời cũ: "${parsed.reply}"

LƯU Ý: CHỈ TRẢ VỀ TEXT CÂU TRẢ LỜI.`

        const refinedReply = await ollamaChat({
          system: "Bạn là Stylist AI. Hãy viết lại câu trả lời dựa trên danh sách sản phẩm thật. CHỈ TRẢ VỀ TEXT.",
          messages: [
            ...messages.slice(-2),
            { role: 'user', content: contextualPrompt }
          ],
          maxTokens: 512
        })
        
        if (refinedReply && refinedReply.trim().length > 10) {
          parsed.reply = sanitizeResponse(refinedReply)
        }
      }
    } else {
      parsed.reply = sanitizeResponse(parsed.reply)
    }

    await saveMessage(pool, { 
      conversationId, 
      role: 'assistant', 
      content: parsed.reply 
    })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    res.write(`data: ${JSON.stringify({
      type: 'response',
      text: parsed.reply,
      shouldAskMore: parsed.shouldAskMore,
      collectedInfo: parsed.collectedInfo,
      products,
    })}\n\n`)

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  })
)

export default router
