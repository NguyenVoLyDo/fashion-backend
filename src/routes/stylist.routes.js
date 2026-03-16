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
import {
  getUserPreferences,
  upsertPreferences
} from '../queries/preferences.queries.js'
import {
  getContext,
  upsertContext,
  appendExcludedProducts,
  resetContext
} from '../queries/conversation-context.queries.js'

const router = Router()

// In-memory store for guest preferences
const guestPrefs = new Map()

/**
 * Filter out JSON, Chinese, and leaked system instructions
 */
function sanitizeResponse(text) {
  if (!text) return ''
  
  // 1. Remove everything from the first '{' or '```json'
  let clean = text.split(/\{|```json/)[0]
  
  // 2. Remove Chinese characters & Japanese/Korean if any
  clean = clean.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, '')
  
  // 3. Remove AI control tokens (e.g. <|im_start|>)
  clean = clean.replace(/<\|.*?\|>/g, '')
  
  // 4. Remove weird punctuation artifacts like full-width question marks
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

/**
 * Extract structured context from natural language using Regex
 */
function extractContextFromMessage(message, profile) {
  const text = message.toLowerCase()
  const updates = {}

  // 1. Gender / Target Gender
  const femaleKeywords = ["bạn gái", "vợ", "mẹ", "chị", "em gái", "con gái", "nữ", "female"]
  const maleKeywords = ["bạn trai", "ba", "bố", "anh", "em trai", "con trai", "nam", "male"]
  const selfKeywords = ["bản thân", "mình", "tôi", "tao"]

  if (femaleKeywords.some(kw => text.includes(kw))) {
    updates.target_gender = 'female'
    if (text.includes("bạn gái") || text.includes("vợ") || text.includes("mẹ") || text.includes("chị") || text.includes("em gái")) {
       updates.recipient = 'other' 
    }
  } else if (maleKeywords.some(kw => text.includes(kw))) {
    updates.target_gender = 'male'
    if (text.includes("bạn trai") || text.includes("ba") || text.includes("bố") || text.includes("anh") || text.includes("em trai")) {
       updates.recipient = 'other'
    }
  }

  if (selfKeywords.some(kw => text.includes(kw))) {
    updates.recipient = 'self'
    if (profile?.gender) {
      updates.target_gender = profile.gender
    }
  }

  // 2. Occasion
  if (text.match(/đi làm|công sở|văn phòng|công ty/)) updates.occasion = 'work'
  if (text.match(/dạo phố|đi chơi|casual|đường phố|hằng ngày/)) updates.occasion = 'casual'
  if (text.match(/sự kiện|tiệc|dự tiệc|đám cưới|gala|dạ hội/)) updates.occasion = 'event'
  if (text.match(/thể thao|gym|tập luyện|chạy bộ|yoga/)) updates.occasion = 'sport'

  // 3. Style
  if (text.match(/tối giản|minimalist|đơn giản|basic/)) updates.style = 'minimal'
  if (text.match(/thanh lịch|elegant|lịch sự|formal/)) updates.style = 'elegant'
  if (text.match(/năng động|sporty|trẻ trung|năng nổ/)) updates.style = 'dynamic'
  if (text.match(/cá tính|độc đáo|cá nhân|khác biệt|streetwear/)) updates.style = 'unique'

  // 4. Max Price
  const maxKMatch = text.match(/dưới (\d+)\s*(k|nghìn)/)
  if (maxKMatch) updates.max_price = parseInt(maxKMatch[1]) * 1000
  
  const maxTrMatch = text.match(/dưới (\d+)\s*(triệu|tr)/)
  if (maxTrMatch) updates.max_price = parseInt(maxTrMatch[1]) * 1000000

  const budgetKMatch = text.match(/tầm (\d+)\s*k/)
  if (budgetKMatch) updates.max_price = parseInt(budgetKMatch[1]) * 1000

  const budgetTrMatch = text.match(/khoảng (\d+)\s*(triệu|tr)/)
  if (budgetTrMatch) updates.max_price = parseInt(budgetTrMatch[1]) * 1000000

  // 5. Min Price
  const minMatch = text.match(/từ (\d+)\s*(k|nghìn) trở lên|trên (\d+)\s*(k|nghìn)/)
  if (minMatch) {
    const val = minMatch[1] || minMatch[3]
    updates.min_price = parseInt(val) * 1000
  }

  return updates
}

function checkResetIntent(text) {
  const resetKeywords = ["bắt đầu lại", "tìm kiếm khác", "thôi không cần", "reset"]
  return resetKeywords.some(kw => text.toLowerCase().includes(kw))
}

/**
 * Extract structured preferences from natural language using Ollama
 */
async function extractUserPreferences(text) {
  try {
    const prompt = `Phân tích câu nói sau và extract thông tin sở thích thời trang.
Trả về JSON array, mỗi item có: key, value, source ('explicit' hoặc 'inferred').

Ví dụ input: "mình hay mặc đồ tối màu, không thích màu sặc sỡ"
Ví dụ output:
[
  {"key": "preferred_colors", "value": "tối màu, đen, navy, xám", "source": "explicit"},
  {"key": "disliked_colors", "value": "màu sặc sỡ, neon", "source": "explicit"}
]

Ví dụ input: "mình làm văn phòng"
Ví dụ output:
[
  {"key": "occupation", "value": "văn phòng", "source": "explicit"},
  {"key": "preferred_occasions", "value": "đi làm, công sở", "source": "inferred"}
]

Keys chuẩn nên dùng:
- preferred_colors, disliked_colors
- preferred_styles (tối giản, thanh lịch, năng động, cá tính, streetwear)
- disliked_styles
- preferred_occasions (đi làm, dạo phố, sự kiện, thể thao)
- budget_range (dưới 300k / 300-500k / 500k-1tr / trên 1tr)
- occupation
- body_notes (ghi chú về vóc dáng nếu user đề cập)

Chỉ extract thông tin thực sự có trong câu nói. Không suy luận quá xa.
Trả về [] nếu không có thông tin sở thích.

Input: "${text}"`

    const response = await ollamaChat({
      system: "Bạn là chuyên gia phân tích dữ liệu thời trang. Trả về JSON array.",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    })

    const match = response.match(/\[[\s\S]*\]/)
    if (match) {
      return JSON.parse(match[0])
    }
  } catch (error) {
    console.error('Preference extraction error:', error)
  }
  return []
}

// System prompt cho Stylist Bot - NÂNG CẤP VỚI CONTEXT PERSISTENCE
function buildStylistPrompt(profile, context = {}) {
  const genderMap = { 'male': 'Nam', 'female': 'Nữ' };
  const occasionMap = { 'work': 'Đi làm', 'casual': 'Dạo phố', 'event': 'Sự kiện', 'sport': 'Thể thao' };
  const styleMap = { 'minimal': 'Tối giản', 'elegant': 'Thanh lịch', 'dynamic': 'Năng động', 'unique': 'Cá tính' };

  const excludedCount = context.excluded_product_ids?.length || 0;

  return `Bạn là Stylist AI chuyên nghiệp. Hãy tư vấn ngắn gọn nhưng đầy đủ, tự nhiên.
TUYỆT ĐỐI CHỈ DÙNG TIẾNG VIỆT.

ĐÃ BIẾT VỀ KHÁCH HÀNG:
${context.target_gender ? `- Giới tính người mặc: ${genderMap[context.target_gender] || context.target_gender}` : ''}
${context.occasion ? `- Dịp mặc: ${occasionMap[context.occasion] || context.occasion}` : ''}
${context.style ? `- Phong cách: ${styleMap[context.style] || context.style}` : ''}
${context.max_price ? `- Ngân sách tối đa: ${context.max_price.toLocaleString('vi-VN')}₫` : ''}

QUY TẮC:
- KHÔNG hỏi lại bất kỳ thông tin nào đã có trong "ĐÃ BIẾT" ở trên.
- Nếu thiếu giới tính hoặc dịp mặc VÀ đây là lần đầu chat (chưa có thông tin gì) -> hỏi 1 câu ngắn gộp cả 2.
- Nếu đã chat hơn 1 lượt mà vẫn thiếu -> tự suy luận dựa trên tin nhắn user và gợi ý luôn, đừng hỏi lặp lại.
- Sản phẩm đã gợi ý (${excludedCount} sản phẩm) -> KHÔNG gợi ý lại.
- Trả về JSON với "reply", "nextQuestion", "shouldAskMore", "filters".`
}

// POST /stylist/reset
router.post(
  '/reset',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { conversationId } = req.body
    if (!conversationId) {
      const { userId, sessionId } = req
      const convoId = await getOrCreateConversation(pool, { userId, sessionId, type: 'stylist' })
      await resetContext(pool, convoId)
      return res.json({ success: true, message: 'Context reset successfully' })
    }
    await resetContext(pool, conversationId)
    res.json({ success: true, message: 'Context reset successfully' })
  })
)

// POST /stylist/chat
router.post(
  '/chat',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { message } = req.body

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required', code: 'NO_MESSAGE' })
    }

    const userId = req.user?.id ?? null
    const sessionId = req.sessionId ?? null

    const conversationId = await getOrCreateConversation(pool, { userId, sessionId, type: 'stylist' })
    
    // 0. Check reset intent
    if (checkResetIntent(message)) {
      await resetContext(pool, conversationId)
      // Save user message
      await saveMessage(pool, { conversationId, role: 'user', content: message })
      const reply = "Được rồi! Mình bắt đầu lại nhé. Bạn đang tìm gì?"
      await saveMessage(pool, { conversationId, role: 'assistant', content: reply })
      
      return res.json({
        type: 'response',
        text: reply,
        shouldAskMore: true,
        products: []
      })
    }

    // 1. Load context từ DB
    let context = await getContext(pool, conversationId) || { conversation_id: conversationId }

    // 2. Fetch profile
    const profile = userId ? await getUserProfile(pool, userId) : null

    // 3. Extract từ tin nhắn hiện tại
    const extracted = extractContextFromMessage(message, profile)
    
    // 4. Merge & Save context (upsertContext handles merging non-nulls)
    context = await upsertContext(pool, conversationId, extracted)

    // Save user message
    await saveMessage(pool, { conversationId, role: 'user', content: message })

    // Load recent history for AI context (just for tone/flow, context values are in system prompt)
    const dbHistory = await getRecentMessages(pool, conversationId, 6)
    const messagesForHistory = dbHistory.map(m => ({ role: m.role, content: m.content }))

    // 5. Build system prompt với context rõ ràng
    const systemPrompt = buildStylistPrompt(profile, context)

    // 6. Gọi Ollama
    const raw = await ollamaChat({
      system: systemPrompt,
      messages: messagesForHistory,
      maxTokens: 512,
      temperature: 0.2
    })

    // Parse JSON
    let parsed = { 
      reply: raw, 
      nextQuestion: null,
      shouldAskMore: true,
      filters: { shouldRecommend: false }
    }
    
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = { ...parsed, ...JSON.parse(jsonMatch[0]) }
      }
    } catch (e) {
      console.error('Stylist JSON Parse Error:', e)
      parsed.reply = sanitizeResponse(raw)
    }

    // Preference extraction (Async) - Long term preferences
    extractUserPreferences(message).then(async (prefs) => {
      if (prefs.length > 0 && userId) {
        await upsertPreferences(pool, userId, prefs)
      }
    }).catch(err => console.error('Pref extract async error:', err))

    // 7. Determine if should recommend
    const missingCrucial = !context.target_gender || !context.occasion;
    const userTurns = messagesForHistory.filter(m => m.role === 'user').length;

    if (!missingCrucial || userTurns >= 4) {
      parsed.filters.shouldRecommend = true;
      parsed.shouldAskMore = false;
    }

    let products = []
    if (parsed.filters?.shouldRecommend || !parsed.shouldAskMore) {
      const prefColors = []; // Could fetch from dbPreferences if needed
      
      const recommendationParams = {
        categorySlug: parsed.filters.categorySlug || null,
        maxPrice: context.max_price || null,
        minPrice: context.min_price || null,
        gender: context.target_gender || null,
        excludeProductIds: context.excluded_product_ids || [],
        preferredColors: prefColors,
        dislikedColors: [],
        limit: 4
      }

      products = await getProductRecommendations(pool, recommendationParams)

      if (products.length > 0) {
        // Record products as excluded FOR NEXT TIME
        await appendExcludedProducts(pool, conversationId, products.map(p => p.id))

        const productListStr = products.map(p => `- ${p.name} (giá: ${Number(p.basePrice).toLocaleString('vi-VN')}₫)`).join('\n')
        const contextualPrompt = `Dưới đây là danh sách sản phẩm THẬT từ database:
${productListStr}

HÃY THAY THẾ hoàn toàn câu trả lời cũ bằng một câu trả lời mới thân thiện và dẫn dắt khéo léo vào các sản phẩm trên.
KHÔNG lặp lại danh sách sản phẩm nếu nó đã có trong câu trả lời cũ.
KHÔNG giới thiệu sản phẩm không có trong danh sách trên.
Câu trả lời cũ: "${parsed.reply}"

LƯU Ý: CHỈ TRẢ VỀ TEXT CÂU TRẢ LỜI MỚI.`

        const refinedReply = await ollamaChat({
          system: "Bạn là Stylist AI. Hãy viết câu trả lời giới thiệu sản phẩm thật. Ngắn gọn, tự nhiên, TIẾNG VIỆT 100%.",
          messages: [{ role: 'user', content: contextualPrompt }],
          maxTokens: 512,
          temperature: 0.2
        })
        
        if (refinedReply && refinedReply.trim().length > 5) {
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

    // SSE or Regular JSON? Original code used SSE but didn't actually stream chunks.
    // Fixed format to match original expectation
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    res.write(`data: ${JSON.stringify({
      type: 'response',
      text: parsed.reply,
      nextQuestion: parsed.nextQuestion,
      shouldAskMore: parsed.shouldAskMore,
      products,
    })}\n\n`)

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  })
)

export default router
