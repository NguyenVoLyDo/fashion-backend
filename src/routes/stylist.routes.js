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
  
  // 1. Remove everything from the first '{' or '```json'
  let clean = text.split(/\{|```json/)[0]
  
  // 2. Remove Chinese characters & Japanese/Korean if any
  clean = clean.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, '')
  
  // 3. Remove weird punctuation artifacts like full-width question marks
  clean = clean.replace(/？/g, '?').replace(/：/g, ':')
  
  // 4. Strip common leaked system keywords and artifacts
  const artifacts = [
    /LƯU Ý:/gi, /QUY TẮC:/gi, /NHIỆM VỤ:/gi, /JSON output/gi,
    /Hãy viết lại/gi, /CHỈ TRẢ VỀ TEXT/gi, /"filters":/gi, /"collectedInfo":/gi,
    /,\s*$/g, /,\s*"filters".*$/gi, /\}\s*$/g
  ]
  artifacts.forEach(regex => {
    clean = clean.replace(regex, '')
  })
  
  clean = clean.trim()
  
  if (!clean || clean.length < 3) {
    return "Tuyệt vời! Dưới đây là những gợi ý phù hợp nhất cho nhu cầu của bạn nhé:"
  }
  
  return clean
}

// System prompt cho Stylist Bot - NÂNG CẤP ĐA BƯỚC
function buildStylistPrompt(user, profile, purchaseHistory, availableCategories) {
  const currentInfo = profile?.collectedInfo || {};
  const { recipientDescription, targetGender, occasion, style, budget } = currentInfo;

  return `Bạn là Stylist AI chuyên nghiệp. Hãy tư vấn ngắn gọn, đi thẳng vào vấn đề.
TUYỆT ĐỐI CHỈ DÙNG TIẾNG VIỆT. KHÔNG DÙNG TIẾNG TRUNG.

🚩 TRẠNG THÁI HIỆN TẠI (Chỉ hỏi field nào là "Chưa biết"):
- Đối tượng: ${recipientDescription || 'Chưa biết'}
- Giới tính (targetGender): ${targetGender || 'Chưa biết'}
- Dịp: ${occasion || 'Chưa biết'}
- Phong cách: ${style || 'Chưa biết'}
- Ngân sách: ${budget || 'Chưa biết'}

🚩 QUY TẮC:
1. KHÔNG hỏi lại thông tin đã có.
2. Nếu THIẾU thông tin -> hỏi 1 câu DUY NHẤT cực ngắn. 
3. Nếu ĐỦ 5 thông tin hoặc CÓ Ngân sách -> set shouldRecommend: true, shouldAskMore: false.
4. Gợi ý sản phẩm thuộc danh mục: ${availableCategories.join(', ')}.

PHẢI TRẢ VỀ JSON:
{
  "reply": "câu trả lời ngắn gọn tiếng Việt",
  "shouldAskMore": boolean, 
  "collectedInfo": {
    "recipientDescription": "ai?",
    "targetGender": "male/female",
    "occasion": "...", 
    "style": "...", 
    "budget": number
  },
  "filters": {
    "categorySlug": "...",
    "targetGender": "male/female",
    "shouldRecommend": boolean 
  }
}`
}
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
      temperature: 0.2 // Giảm temperature để ổn định hơn, tránh lặp
    })

    // Parse JSON
    let parsed = { 
      reply: raw, 
      shouldAskMore: true,
      filters: { shouldRecommend: false },
      collectedInfo: collectedInfo // Bắt đầu bằng thông tin cũ
    }
    
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const p = JSON.parse(match[0])
        parsed = { ...parsed, ...p }
        
        // Merge collectedInfo thay vì ghi đè hoàn toàn để giữ các field cũ nếu AI làm mất
        parsed.collectedInfo = { ...collectedInfo, ...p.collectedInfo }

        // Validation
        if (parsed.filters?.categorySlug && !availableCategories.includes(parsed.filters.categorySlug)) {
          parsed.filters.categorySlug = null
        }
      }
    } catch (e) {
      console.error('Stylist JSON Parse Error:', e)
      parsed.reply = sanitizeResponse(raw)
    }

    // SAFETY VALVE: Ép recommend nếu đã đủ thông tin quan trọng
    const hasAllInfo = parsed.collectedInfo.recipientDescription && 
                       parsed.collectedInfo.targetGender && 
                       parsed.collectedInfo.occasion && 
                       parsed.collectedInfo.style && 
                       parsed.collectedInfo.budget;

    if (hasAllInfo || parsed.collectedInfo.budget) {
      parsed.shouldAskMore = false
      parsed.filters.shouldRecommend = true
    }

    // Fetch sản phẩm nếu đủ điều kiện
    let products = []
    if (parsed.filters?.shouldRecommend && !parsed.shouldAskMore) {
      // Logic xác định target gender cho filter
      let filterGender = parsed.filters?.targetGender || parsed.collectedInfo?.targetGender;
      
      // Nếu không có thông tin giới tính đích mà là mua cho bản thân, dùng giới tính profile
      if (!filterGender && parsed.collectedInfo?.recipientDescription?.toLowerCase().includes('bản thân')) {
        filterGender = profile?.gender;
      }

      products = await getProductRecommendations(pool, {
        categorySlug: parsed.filters.categorySlug || undefined,
        maxPrice: parsed.filters.maxPrice || undefined,
        minPrice: parsed.filters.minPrice || undefined,
        gender: filterGender || undefined,
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
