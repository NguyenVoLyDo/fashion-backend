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

// System prompt cho Stylist Bot - NÂNG CẤP ĐA BƯỚC
function buildStylistPrompt(user, profile, purchaseHistory, availableCategories) {
  const userAge = profile?.birthYear ? (new Date().getFullYear() - profile.birthYear) : null;
  const userGender = profile?.gender || null;
  const currentInfo = profile?.collectedInfo || {};
  const { recipientDescription, targetGender, occasion, style, budget } = currentInfo;

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
    
    // Helper parse nhanh ngân sách nếu AI trả về text
    const parseBudget = (text) => {
      const match = text.match(/([\d.]+)\s*(triệu|tr|tỉ|t|k)/i);
      if (match) {
        let val = parseFloat(match[1].replace(/\./g, ''));
        const unit = match[2].toLowerCase();
        if (unit.startsWith('tr')) return val * 1000000;
        if (unit.startsWith('t')) return val * 1000000000;
        if (unit.startsWith('k')) return val * 1000;
      }
      return null;
    }

    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const p = JSON.parse(match[0])
        parsed = { ...parsed, ...p }
        
        // Cố gắng parse budget từ reply nếu collectedInfo.budget trống
        if (!parsed.collectedInfo?.budget) {
          const b = parseBudget(message);
          if (b) {
             if (!parsed.collectedInfo) parsed.collectedInfo = {};
             parsed.collectedInfo.budget = b;
          }
        }
        // Merge thông minh: chỉ ghi đè nếu AI trả về giá trị thực sự (không null/undefined/empty)
        const mergedInfo = { ...collectedInfo }
        if (p.collectedInfo) {
          Object.keys(p.collectedInfo).forEach(key => {
            const val = p.collectedInfo[key]
            if (val !== null && val !== undefined && val !== '') {
              mergedInfo[key] = val
            }
          })
        }
        parsed.collectedInfo = mergedInfo

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
        const productListStr = products.map(p => `- ${p.name} (giá: ${Number(p.basePrice).toLocaleString('vi-VN')}₫)`).join('\n')
        const contextualPrompt = `Dưới đây là danh sách sản phẩm thật từ cửa hàng:
${productListStr}

Hãy viết lại câu trả lời sau để giới thiệu khéo léo ít nhất 2 sản phẩm trên. 
Giữ phong cách chuyên nghiệp, thời trang và thân thiện. Không được bịa thêm sản phẩm khác. 
Sửa lỗi kỹ thuật: "vo" -> "vợ".
Câu trả lời cũ: "${parsed.reply}"

LƯU Ý: CHỈ TRẢ VỀ TEXT CÂU TRẢ LỜI. TUYỆT ĐỐI KHÔNG ĐẶT CÂU HỎI MỚI. 
Nếu câu trả lời cũ có câu hỏi (VD: "Bạn mua đồ cho ai?"), hãy LOẠI BỎ nó và chỉ tập trung vào việc giới thiệu sản phẩm.`

        const refinedReply = await ollamaChat({
          system: "Bạn là Stylist AI chuyên nghiệp. Hãy giới thiệu sản phẩm thật một cách tự nhiên bằng tiếng Việt chuẩn. TUYỆT ĐỐI KHÔNG DÙNG TIẾNG TRUNG.",
          messages: [
            ...messages.slice(-2),
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
      shouldAskMore: parsed.shouldAskMore,
      collectedInfo: parsed.collectedInfo,
      products,
    })}\n\n`)

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  })
)

export default router
