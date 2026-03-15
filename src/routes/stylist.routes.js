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
 * Extract state from chat history using Regex
 */
function extractCollectedInfo(messages) {
  const info = {
    recipientDescription: null,
    targetGender: null,
    occasion: null,
    style: null,
    budget: null
  }

  messages.forEach(m => {
    const text = m.content.toLowerCase()
    
    // 1. Đối tượng
    if (text.includes('cho bản thân') || text.includes('cho mình') || text.includes('cho tôi')) info.recipientDescription = 'Bản thân'
    if (text.includes('tặng bạn gái') || text.includes('tặng vợ') || text.includes('cho vợ')) {
      info.recipientDescription = 'Bạn gái / Vợ'
      info.targetGender = 'female'
    }
    if (text.includes('tặng bạn trai') || text.includes('tặng chồng') || text.includes('cho chồng')) {
      info.recipientDescription = 'Bạn trai / Chồng'
      info.targetGender = 'male'
    }
    if (text.includes('cho con') || text.includes('cho bé')) info.recipientDescription = 'Con cái / Người thân'

    // 2. Giới tính
    if (text.includes(' nam') || text.includes(' bé trai') || text.includes(' trai')) info.targetGender = 'male'
    if (text.includes(' nữ') || text.includes(' bé gái') || text.includes(' gái')) info.targetGender = 'female'

    // 3. Dịp
    if (text.includes('đi làm') || text.includes('công sở')) info.occasion = 'Đi làm'
    if (text.includes('dạo phố') || text.includes('đi chơi')) info.occasion = 'Dạo phố'
    if (text.includes('hẹn hò') || text.includes('đi date')) info.occasion = 'Hẹn hò'
    if (text.includes('sự kiện') || text.includes('tiệc')) info.occasion = 'Sự kiện'

    // 4. Phong cách
    if (text.includes('tối giản') || text.includes('minimalist')) info.style = 'Tối giản'
    if (text.includes('thanh lịch') || text.includes('elegant')) info.style = 'Thanh lịch'
    if (text.includes('năng động') || text.includes('active')) info.style = 'Năng động'
    if (text.includes('cá tính') || text.includes('individual')) info.style = 'Cá tính'

    // 5. Ngân sách
    const budgetMatch = text.match(/(\d+)\s*(k|triệu|tr|vnd|đ)/i)
    if (budgetMatch) {
      let val = parseInt(budgetMatch[1])
      if (budgetMatch[2].toLowerCase() === 'k') val *= 1000
      if (budgetMatch[2].toLowerCase() === 'triệu' || budgetMatch[2].toLowerCase() === 'tr') val *= 1000000
      info.budget = val
    }
  })

  return info
}

// System prompt cho Stylist Bot - NÂNG CẤP ĐA BƯỚC
function buildStylistPrompt(user, profile, historyInfo, purchaseHistory) {
  const userAge = profile?.birthYear ? (new Date().getFullYear() - profile.birthYear) : null;
  const userGender = profile?.gender || null;
  
  // Ưu tiên thông tin vừa extract từ history, nếu không có mới dùng từ profile
  const recipientDescription = historyInfo.recipientDescription || null;
  const targetGender = historyInfo.targetGender || null;
  const occasion = historyInfo.occasion || null;
  const style = historyInfo.style || null;
  const budget = historyInfo.budget || null;

  const profileCtx = `Thông tin chủ tài khoản: ${userGender === 'male' ? 'Nam' : userGender === 'female' ? 'Nữ' : 'Chưa rõ'}${userAge ? `, ${userAge} tuổi` : ''}.`

  const historyContext = purchaseHistory.length > 0
    ? `\nLịch sử mua hàng của khách:
${purchaseHistory.map(p =>
  `- ${p.name} (${p.categoryName}, màu ${p.colorName}, size ${p.sizeName})`
).join('\n')}`
    : ''

  return `Bạn là Stylist AI chuyên nghiệp. Hãy tư vấn ngắn gọn nhưng đầy đủ, tự nhiên.
TUYỆT ĐỐI CHỈ DÙNG TIẾNG VIỆT. KHÔNG DÙNG TIẾNG TRUNG.

${profileCtx}${historyContext}

🚩 TRẠNG THÁI HIỆN TẠI (ĐÃ BIẾT - TUYỆT ĐỐI KHÔNG hỏi lại):
- Đối tượng: **${recipientDescription || 'Chưa biết'}**
- Giới tính người mặc: **${targetGender || 'Chưa biết'}**
- Dịp: **${occasion || 'Chưa biết'}**
- Phong cách: **${style || 'Chưa biết'}**
- Ngân sách: **${budget ? budget.toLocaleString('vi-VN') + 'đ' : 'Chưa biết'}**

🚩 QUY TẮC BẮT BUỘC:
1. Nếu User nhắn "tang ban gai" -> hiểu là "Tặng bạn gái/vợ", set targetGender: "female". KHÔNG ĐƯỢC hiểu là "tiệc tang".
2. **LUẬT SẮT**: Nếu Đối tượng ĐÃ KHÁC "Chưa biết" -> **CẤM TUYỆT ĐỐI** việc hỏi lại "Cho ai?" hay "Đối tượng nào?". Hãy dùng xưng hô thân mật phù hợp để hỏi Dịp/Phong cách.
3. Nếu đã có Dịp & Phong cách -> BẮT BUỘC chuyển sang hỏi Ngân sách.
4. Phản hồi phải tự nhiên, sử dụng tiếng Việt có dấu chuẩn xác (VD: "vợ" thay vì "vo").
5. Nếu Đối tượng là "Con cái/Người thân" mà chưa rõ giới tính -> BẮT BUỘC hỏi: "Bạn đang tìm đồ cho bé trai hay bé gái?".
6. Nếu đã có Ngân sách -> set "shouldRecommend": true và "shouldAskMore": false.
7. **QUY TẮC GIỚI TÍNH**: Nếu mua cho bản thân, TUYỆT ĐỐI KHÔNG gợi ý sản phẩm trái ngược với giới tính trong profile (ví dụ: profile Nam không gợi ý váy/đầm).
8. Đảm bảo "reply" dẫn dắt mượt mà vào sản phẩm nếu shouldRecommend là true.

PHẢI TRẢ VỀ JSON:
{
  "reply": "câu trả lời thân thiện, dẫn dắt vào sản phẩm",
  "shouldAskMore": boolean, 
  "collectedInfo": {
    "recipientDescription": "...",
    "targetGender": "male" | "female",
    "occasion": "...", 
    "style": "...", 
    "budget": number
  },
  "filters": {
    "categorySlug": "...",
    "targetGender": "male" | "female",
    "shouldRecommend": boolean 
  }
}`
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

    await saveMessage(pool, { conversationId, role: 'user', content: message })

    const messagesForHistory = [
      ...dbHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ]

    // 1. Tự động extract thông tin từ history (JS side)
    const historyInfo = extractCollectedInfo(messagesForHistory)

    // 2. Fetch dữ liệu cơ bản
    const [profile, purchaseHistory, { rows: catRows }] = await Promise.all([
      userId ? getUserProfile(pool, userId) : Promise.resolve(null),
      userId ? getUserPurchaseHistory(pool, userId) : Promise.resolve([]),
      pool.query(`SELECT slug FROM categories`),
    ])

    const availableCategories = catRows.map(r => r.slug)
    const excludeIds = purchaseHistory.map(p => p.productId)

    // 3. Tự động xác định target gender từ profile nếu mua cho bản thân
    if (!historyInfo.targetGender && (!historyInfo.recipientDescription || historyInfo.recipientDescription === 'Bản thân')) {
      if (profile?.gender) historyInfo.targetGender = profile.gender
    }

    // 3. Gọi AI với state đã extract
    const raw = await ollamaChat({
      system: buildStylistPrompt(req.user, profile, historyInfo, purchaseHistory),
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
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        parsed = { ...parsed, ...JSON.parse(match[0]) }
      }
    } catch (e) {
      console.error('Stylist JSON Parse Error:', e)
      parsed.reply = sanitizeResponse(raw)
    }

    // 4. FALLBACK & SAFETY VALVE
    // Cập nhật collectedInfo dựa trên cả JS extraction và AI parsing
    const finalInfo = {
      ...historyInfo,
      ...(parsed.collectedInfo || {}) // Nếu AI có parse thêm được gì mới
    }

    const infoCount = Object.values(finalInfo).filter(v => v !== null && v !== undefined && v !== '').length
    const turnCount = Math.floor(dbHistory.length / 2)

    if (infoCount >= 4 || turnCount >= 3) {
      parsed.shouldAskMore = false
      parsed.filters.shouldRecommend = true
    }

    // Fetch sản phẩm nếu đủ điều kiện (recommend: true HOẶC bot không muốn hỏi thêm nữa)
    let products = []
    const isReadyToRecommend = parsed.filters?.shouldRecommend || !parsed.shouldAskMore;
    
    if (isReadyToRecommend) {
      // Logic xác định target gender cho filter
      let filterGender = parsed.filters?.targetGender || parsed.collectedInfo?.targetGender || collectedInfo.targetGender;
      
      const recipient = (parsed.collectedInfo?.recipientDescription || collectedInfo.recipientDescription || '').toLowerCase();
      
      // Nếu không có thông tin giới tính đích mà là mua cho bản thân hoặc chưa rõ đối tượng, dùng giới tính profile
      if (!filterGender) {
        const isForSelf = !recipient || 
                          recipient === 'chưa biết' || 
                          recipient.includes('bản thân') || 
                          recipient.includes('mình') || 
                          recipient.includes('tôi');
        
        if (isForSelf) {
          filterGender = profile?.gender;
        }
      }

      const recommendationParams = {
        categorySlug: parsed.filters.categorySlug || null,
        maxPrice: parsed.filters.maxPrice || parsed.collectedInfo?.budget || collectedInfo.budget || null,
        minPrice: parsed.filters.minPrice || null,
        gender: filterGender || null,
        excludeProductIds: excludeIds,
        limit: 4
      }

      products = await getProductRecommendations(pool, recommendationParams)

      // FALLBACK: Nếu không tìm thấy sản phẩm với category cụ thể, thử tìm rộng hơn
      if (products.length === 0 && recommendationParams.categorySlug) {
        products = await getProductRecommendations(pool, {
          ...recommendationParams,
          categorySlug: null
        })
      }

      if (products.length > 0) {
        // Đã có sản phẩm -> Kết thúc lượt hỏi
        parsed.shouldAskMore = false;
        parsed.filters.shouldRecommend = true;

        const productListStr = products.map(p => `- ${p.name} (giá: ${Number(p.basePrice).toLocaleString('vi-VN')}₫)`).join('\n')
        const contextualPrompt = `Dưới đây là danh sách sản phẩm THẬT từ database:
${productListStr}

HÃY THAY THẾ hoàn toàn câu trả lời cũ bằng một câu trả lời mới thân thiện và dẫn dắt khéo léo vào các sản phẩm trên.
TUYỆT ĐỐI KHÔNG lặp lại danh sách sản phẩm nếu nó đã có trong câu trả lời cũ.
TUYỆT ĐỐI KHÔNG giới thiệu sản phẩm không có trong danh sách trên.
Câu trả lời cũ: "${parsed.reply}"

LƯU Ý: CHỈ TRẢ VỀ TEXT CÂU TRẢ LỜI MỚI.`

        const refinedReply = await ollamaChat({
          system: "Bạn là Stylist AI. Hãy viết câu trả lời giới thiệu sản phẩm thật. Ngắn gọn, tự nhiên, TIẾNG VIỆT 100%.",
          messages: [
            ...messagesForHistory.slice(-2),
            { role: 'user', content: contextualPrompt }
          ],
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

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    res.write(`data: ${JSON.stringify({
      type: 'response',
      text: parsed.reply,
      nextQuestion: parsed.nextQuestion,
      shouldAskMore: parsed.shouldAskMore,
      collectedInfo: finalInfo,
      products,
    })}\n\n`)

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  })
)

export default router
