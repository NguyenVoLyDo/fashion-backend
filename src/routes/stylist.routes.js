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

  // Detect reset keywords in the LATEST message
  const userMessages = messages.filter(m => m.role === 'user');
  const lastMsg = userMessages[userMessages.length - 1];
  const lastText = lastMsg?.content.toLowerCase() || '';

  const resetKeywords = [
    'phụ kiện', 'túi', 'giày', 'dép', 'mũ', 'thắt lưng', 'ví', 'tất', 'khăn', 'kính',
    'đổi', 'thay', 'thử', 'xem', 'tìm', 'muốn', 'cho tôi', 'gợi ý',
    'áo', 'quần', 'váy', 'đầm', 'jacket', 'hoodie'
  ];

  const isNewRequest = resetKeywords.some(kw => lastText.includes(kw));

  messages.forEach((m, idx) => {
    if (m.role !== 'user') return
    const text = m.content.toLowerCase()
    const isLast = (m === lastMsg);
    
    // 1. Đối tượng & Giới tính (Persistent)
    if (text.includes('cho bản thân') || text.includes('cho mình') || text.includes('cho tôi')) {
      info.recipientDescription = 'Bản thân'
    }
    if (text.includes('tặng bạn gái') || text.includes('tặng vợ') || text.includes('cho vợ') || text.includes('cho bạn gái')) {
      info.recipientDescription = 'Bạn gái / Vợ'
      info.targetGender = 'female'
    }
    if (text.includes('tặng bạn trai') || text.includes('tặng chồng') || text.includes('cho chồng') || text.includes('cho bạn trai')) {
      info.recipientDescription = 'Bạn trai / Chồng'
      info.targetGender = 'male'
    }
    if (text.includes('cho con') || text.includes('cho bé') || text.includes('cho cháu')) {
      info.recipientDescription = 'Con cái / Người thân'
    }

    if (text.includes('đồ nam') || text.includes('cho nam') || text.includes('bé trai') || text.includes(' con trai') || text.includes(' áo nam') || text.includes(' quần nam')) info.targetGender = 'male'
    if (text.includes('đồ nữ') || text.includes('cho nữ') || text.includes('bé gái') || text.includes(' con gái') || text.includes(' áo nữ') || text.includes(' quần nữ') || text.includes(' váy') || text.includes(' đầm')) info.targetGender = 'female'

    // 2. Dịp (Perishable - Reset if new request detected unless in last message)
    if (!isNewRequest || isLast) {
      if (text.includes('đi làm') || text.includes('công sở') || text.includes('văn phòng') || text.includes('đi dạy')) info.occasion = 'Đi làm'
      if (text.includes('dạo phố') || text.includes('đi chơi') || text.includes('cà phê') || text.includes('đi dạo')) info.occasion = 'Dạo phố'
      if (text.includes('hẹn hò') || text.includes('đi date') || text.includes('gặp người yêu')) info.occasion = 'Hẹn hò'
      if (text.includes('sự kiện') || text.includes('tiệc') || text.includes('đám cưới') || text.includes('festival')) info.occasion = 'Sự kiện'
      if (text.includes('thể thao') || text.includes('tập gym') || text.includes('chạy bộ') || text.includes('đá bóng')) info.occasion = 'Thể thao'
      if (text.includes('ở nhà') || text.includes('ngủ')) info.occasion = 'Ở nhà'
    }

    // 3. Phong cách (Perishable - Reset if new request detected unless in last message)
    if (!isNewRequest || isLast) {
      if (text.includes('tối giản') || text.includes('minimalist') || text.includes('đơn giản')) info.style = 'Tối giản'
      if (text.includes('thanh lịch') || text.includes('elegant') || text.includes('trưởng thành')) info.style = 'Thanh lịch'
      if (text.includes('năng động') || text.includes('active') || text.includes('trẻ trung')) info.style = 'Năng động'
      if (text.includes('cá tính') || text.includes('individual') || text.includes('ngầu') || text.includes('unique')) info.style = 'Cá tính'
      if (text.includes('basic') || text.includes('cơ bản')) info.style = 'Basic'
    }

    // 4. Ngân sách (Persistent but overridable)
    const budgetMatch = text.match(/(\d+(?:\.\d+)?)\s*(k|triệu|tr|vnd|đ|đồng)/i)
    if (budgetMatch) {
      let val = parseFloat(budgetMatch[1].replace(/\./g, ''))
      const unit = budgetMatch[2].toLowerCase()
      if (unit === 'k') val *= 1000
      if (unit === 'triệu' || unit === 'tr') val *= 1000000
      info.budget = val
    } else {
      const simpleMatch = text.match(/\b(\d{2,3})k\b/i)
      if (simpleMatch) info.budget = parseInt(simpleMatch[1]) * 1000
    }
  })

  return { info, isNewRequest }
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

// System prompt cho Stylist Bot - NÂNG CẤP ĐA BƯỚC
function buildStylistPrompt(user, profile, historyInfo, purchaseHistory, preferences = []) {
  const userAge = profile?.birthYear ? (new Date().getFullYear() - profile.birthYear) : null;
  const userGender = profile?.gender || null;
  
  // Ưu tiên thông tin vừa extract từ history, nếu không có mới dùng từ profile
  const recipientDescription = historyInfo.recipientDescription || null;
  const targetGender = historyInfo.targetGender || null;
  const occasion = historyInfo.occasion || null;
  const style = historyInfo.style || null;
  const budget = historyInfo.budget || null;

  const collectedList = [
    targetGender ? `✓ Giới tính: ${targetGender === 'male' ? 'Nam' : 'Nữ'}` : null,
    occasion ? `✓ Dịp: ${occasion}` : null,
    style ? `✓ Phong cách: ${style}` : null,
    budget ? `✓ Ngân sách: ${budget.toLocaleString('vi-VN')}₫` : null
  ].filter(Boolean).join('\n')

  const missingList = [
    !targetGender ? '- Giới tính người mặc (Nam/Nữ)' : null,
    !occasion ? '- Mục đích sử dụng (Đi làm, dạo phố, sự kiện...)' : null,
    !style ? '- Phong cách (Tối giản, thanh lịch, năng động...)' : null,
    !budget ? '- Ngân sách khoảng bao nhiêu' : null
  ].filter(Boolean).join('\n')

  return `Bạn là Stylist AI chuyên nghiệp. Hãy tư vấn ngắn gọn nhưng đầy đủ, tự nhiên.
TUYỆT ĐỐI CHỈ DÙNG TIẾNG VIỆT.

THÔNG TIN ĐÃ CÓ TỪ LỊCH SỬ CHAT:
${collectedList || '(Chưa có thông tin nào)'}

THÔNG TIN CÒN THIẾU:
${missingList || '(Đã đủ thông tin)'}

${preferences.length > 0 ? `SỞ THÍCH ĐÃ BIẾT CỦA KHÁCH HÀNG:
${preferences.map(p => {
  const labels = {
    preferred_colors: 'Màu yêu thích',
    disliked_colors: 'Không thích màu',
    preferred_styles: 'Phong cách thích',
    disliked_styles: 'Phong cách không thích',
    preferred_occasions: 'Dịp thường mặc',
    budget_range: 'Ngân sách thường',
    occupation: 'Nghề nghiệp',
    body_notes: 'Vóc dáng'
  }
  return `- ${labels[p.key] || p.key}: ${p.value}`
}).join('\n')}

→ Ưu tiên gợi ý sản phẩm phù hợp với sở thích trên.
→ Không hỏi lại những thông tin đã biết.
→ Nếu user không đề cập ngân sách -> tự dùng ngân sách đã lưu.` : ''}

QUY TẮC:
1. **LUẬT SẮT**: CHỈ hỏi những thông tin CHƯA CÓ trong danh sách "THÔNG TIN ĐÃ CÓ". Tuyệt đối không hỏi lại những gì user đã nói.
2. Nếu danh sách đã có ĐỦ cả 4 thông tin (Giới tính, Dịp, Phong cách, Ngân sách) -> BẮT BUỘC đặt "shouldRecommend": true và gợi ý sản phẩm ngay, KHÔNG hỏi thêm.
3. Nếu còn thiếu thông tin, chỉ hỏi DUY NHẤT 1 câu cho thông tin thiếu quan trọng nhất theo thứ tự: Giới tính -> Dịp -> Phong cách -> Ngân sách.
4. Nếu user nhắn "tặng bạn gái" -> hiểu là "Bạn gái / Vợ", set targetGender: "female".
5. Nếu mua cho bản thân, không gợi ý đồ trái giới tính profile (Profile Nam không gợi ý váy).
6. Khi "shouldRecommend" là true, hãy viết câu dẫn dắt mượt mà vào danh sách sản phẩm.

PHẢI TRẢ VỀ JSON:
{
  "reply": "câu trả lời/câu hỏi thân thiện",
  "nextQuestion": "gender" | "occasion" | "style" | "budget" | null,
  "shouldAskMore": boolean, 
  "collectedInfo": {
    "recipientDescription": "...",
    "targetGender": "male" | "female",
    "occasion": "...", 
    "style": "...", 
    "budget": number
  },
  "filters": {
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
    const { info: historyInfo, isNewRequest } = extractCollectedInfo(messagesForHistory)

    // 2. Fetch dữ liệu cơ bản
    const [profile, purchaseHistory, dbPreferences, { rows: catRows }] = await Promise.all([
      userId ? getUserProfile(pool, userId) : Promise.resolve(null),
      userId ? getUserPurchaseHistory(pool, userId) : Promise.resolve([]),
      userId ? getUserPreferences(pool, userId) : Promise.resolve(guestPrefs.get(sessionId) || []),
      pool.query(`SELECT slug FROM categories`),
    ])

    // 3. Extract preferences (Async) - Only for the current message
    let extractedPrefs = []
    extractUserPreferences(message).then(async (prefs) => {
      if (prefs.length > 0) {
        if (userId) {
          await upsertPreferences(pool, userId, prefs)
        } else if (sessionId) {
          const existing = guestPrefs.get(sessionId) || []
          prefs.forEach(p => {
            const idx = existing.findIndex(e => e.key === p.key)
            if (idx > -1) existing[idx] = p
            else existing.push(p)
          })
          guestPrefs.set(sessionId, existing)
        }
      }
    }).catch(err => console.error('Pref extract async error:', err))

    // Merge current extraction results into dbPreferences for prompt building (approximate)
    // In a real scenario, we might want to wait if it's critical, but task says "không block response chính"
    // So we use what we have in DB/Session now.

    const availableCategories = catRows.map(r => r.slug)
    const excludeIds = purchaseHistory.map(p => p.productId)

    // 4. Inject preferences into historyInfo if missing
    if (!historyInfo.budget) {
      const budgetPref = dbPreferences.find(p => p.key === 'budget_range')
      if (budgetPref) {
        // Simple heuristic: extract number from "300-500k"
        const match = budgetPref.value.match(/(\d+)/)
        if (match) historyInfo.budget = parseInt(match[1]) * 1000 // Very basic fallback
      }
    }

    // 3. Tự động xác định target gender từ profile nếu mua cho bản thân
    if (!historyInfo.targetGender && (!historyInfo.recipientDescription || historyInfo.recipientDescription === 'Bản thân')) {
      if (profile?.gender) historyInfo.targetGender = profile.gender
    }

    // 3. Gọi AI với state đã extract
    const raw = await ollamaChat({
      system: buildStylistPrompt(req.user, profile, historyInfo, purchaseHistory, dbPreferences),
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
    // Nếu là yêu cầu mới (isNewRequest) -> Ưu tiên JS extraction cho occasion/style (vì JS đã reset chúng)
    const finalInfo = {
      ...historyInfo,
      ...(parsed.collectedInfo || {}) 
    }

    if (isNewRequest) {
      finalInfo.occasion = historyInfo.occasion;
      finalInfo.style = historyInfo.style;
    }

    const infoCount = Object.values(finalInfo).filter(v => v !== null && v !== undefined && v !== '').length
    const userTurns = messagesForHistory.filter(m => m.role === 'user').length

    // Giới hạn 4 lượt hỏi hoặc đủ thông tin
    if (infoCount >= 4 || userTurns >= 4) {
      parsed.shouldAskMore = false
      parsed.filters.shouldRecommend = true
    }

    // Fetch sản phẩm nếu đủ điều kiện (recommend: true HOẶC bot không muốn hỏi thêm nữa)
    let products = []
    const isReadyToRecommend = parsed.filters?.shouldRecommend || !parsed.shouldAskMore;
    
    if (isReadyToRecommend) {
      // Logic xác định target gender cho filter
      let filterGender = parsed.filters?.targetGender || parsed.collectedInfo?.targetGender || finalInfo.targetGender;
      
      const recipient = (finalInfo.recipientDescription || '').toLowerCase();
      
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

      const prefColors = dbPreferences.find(p => p.key === 'preferred_colors')?.value.split(/[,，]/).map(s => s.trim()) || []
      const disColors = dbPreferences.find(p => p.key === 'disliked_colors')?.value.split(/[,，]/).map(s => s.trim()) || []

      const recommendationParams = {
        categorySlug: parsed.filters.categorySlug || null,
        maxPrice: parsed.filters.maxPrice || parsed.collectedInfo?.budget || collectedInfo.budget || historyInfo.budget || null,
        minPrice: parsed.filters.minPrice || null,
        gender: filterGender || null,
        excludeProductIds: excludeIds,
        preferredColors: prefColors,
        dislikedColors: disColors,
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
