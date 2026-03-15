import { Router } from 'express'
import asyncHandler from '../middleware/async-handler.js'
import optionalAuth from '../middleware/optional-auth.js'
import pool from '../config/db.js'
import { ollamaChatStream } from '../lib/ollama.js'
import { buildRagContext } from '../lib/rag.js'
import { getRecentMessages, getUserOrdersForBot, saveMessage, getOrCreateConversation, getOrderByNumber } from '../queries/chat.queries.js'

/**
 * Loại bỏ JSON, tiếng Trung và leaked instructions
 */
function sanitizeResponse(text) {
  if (!text) return ''
  let sanitized = text
    // Remove JSON artifacts
    .replace(/```json[\s\S]*?```/gi, '')
    .replace(/\{[\s\S]*?"id"[\s\S]*?\}/gi, '')
    // Remove common system echos
    .replace(/(NHIỆM VỤ:|QUY TẮC:|ĐỐI TƯỢNG:|Bối cảnh:|Hãy đóng vai).*/gsi, '')
    // Remove Chinese characters
    .replace(/[\u4e00-\u9fa5]/g, '')
    .trim()

  return sanitized
}

const router = Router()

// System prompt cho Support Bot
function buildSystemPrompt(user, orders, searchedOrderContext = '', ragContext = '') {
  let orderContext = ''
  if (!user) {
    orderContext = '\n\nKhách chưa đăng nhập. Bạn không có quyền truy cập vào bất kỳ thông tin đơn hàng nào. Tuyệt đối không được đoán hoặc bịa ra mã đơn hàng, sản phẩm hay trạng thái.'
  } else if (orders.length === 0) {
    orderContext = '\n\nKhách đã đăng nhập nhưng chưa có đơn hàng nào trong hệ thống. Tuyệt đối không được bịa ra đơn hàng.'
  } else {
    orderContext = `\n\nĐơn hàng gần đây của khách (CHỈ ĐƯỢC DÙNG DATA NÀY):\n${orders.map(o => `
- Mã đơn: ${o.orderNo}
  Trạng thái: ${translateStatus(o.status)}
  Tổng tiền: ${Number(o.total).toLocaleString('vi-VN')}₫
  Ngày đặt: ${new Date(o.createdAt).toLocaleDateString('vi-VN')}
  Sản phẩm: ${o.items.map(i => `${i.name} (${i.color}/${i.size}) x${i.quantity}`).join(', ')}
`).join('')}`
  }

  const userContext = user
    ? `\nKhách hàng đang đăng nhập: ${user.fullName || user.email}`
    : '\nKhách chưa đăng nhập.'

  const ragSection = ragContext
    ? `\n\n[TÀI LIỆU THAM KHẢO — Dùng thông tin sau để trả lời khách]\n${ragContext}\nLưu ý: Chỉ trả lời dựa trên tài liệu này. Nếu không thấy thông tin, hãy hướng dẫn khách gọi hotline.`
    : ''

  return `Bạn là trợ lý CSKH của Fashion Store — một cửa hàng thời trang online tại Việt Nam.
${userContext}
${orderContext}
${searchedOrderContext}
${ragSection}

NHIỆM VỤ CỦA BẠN:
- Trả lời câu hỏi về đơn hàng, sản phẩm, chính sách
- Hỗ trợ tra cứu trạng thái đơn hàng
- Giải quyết khiếu nại và thắc mắc
- Tư vấn sản phẩm phù hợp

TRẠNG THÁI ĐƠN HÀNG:
- Chờ xác nhận → Đã xác nhận → Đang xử lý → Đang giao → Đã giao → Hoàn thành
- Huỷ đơn chỉ được khi trạng thái "Chờ xác nhận"

QUY TẮC TRẢ LỜI (TUYỆT ĐỐI TUÂN THỦ):
- Luôn dùng tiếng Việt, thân thiện, ngắn gọn.
- Xưng "em", gọi khách là "anh/chị".
- KHÔNG BAO GIỜ bịa thông tin về đơn hàng (mã đơn, trạng thái, sản phẩm) không có trong context.
- Nếu có block [TRA CỨU ĐƠN HÀNG THEO YÊU CẦU] → dùng chính xác thông tin đó để trả lời.
- Hướng dẫn khách cách tìm mã đơn: "Mã đơn có dạng ORD-YYYYMMDD-XXXX, anh/chị có thể xem trong trang Đơn hàng của tôi".
- Nếu khách hỏi "đơn hàng của tôi" mà không nêu mã → liệt kê các đơn gần nhất từ context (nếu có).
- Nếu khách muốn huỷ đơn → kiểm tra status trong context, chỉ hướng dẫn huỷ nếu status là "Chờ xác nhận" (pending), ngược lại giải thích không thể huỷ.
- Nếu khách hỏi về một đơn hàng cụ thể mà không có trong context -> Trả lời rõ là "Em không tìm thấy thông tin đơn hàng này trong hệ thống".
- Nếu khách chưa đăng nhập và hỏi về đơn hàng -> Yêu cầu khách đăng nhập để kiểm tra.
- Nếu khách đã đăng nhập nhưng không có đơn hàng -> Thông báo khách chưa có đơn hàng nào.
- Nếu không biết thông tin khác -> hướng dẫn liên hệ hotline: 1800-xxxx.
- Trả lời tối đa 3-4 câu, trừ khi cần giải thích chi tiết.
- Không được đoán, không được "có lẽ", "chắc là" về tình trạng đơn hàng.`
}

function translateStatus(status) {
  const map = {
    pending: 'Chờ xác nhận',
    confirmed: 'Đã xác nhận',
    processing: 'Đang xử lý',
    shipped: 'Đang giao hàng',
    delivered: 'Đã giao',
    completed: 'Hoàn thành',
    cancelled: 'Đã huỷ',
    refunded: 'Đã hoàn tiền',
  }
  return map[status] || status
}

// POST /ai/chat
router.post(
  '/chat',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { message, conversationId: existingConvId } = req.body

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required', code: 'NO_MESSAGE' })
    }

    const userId = req.user?.id ?? null
    const sessionId = req.sessionId ?? null

    // Lấy hoặc tạo conversation
    const conversationId = existingConvId
      || await getOrCreateConversation(pool, { userId, sessionId, type: 'support' })

    // Load history + user orders + RAG context
    const [history, orders, ragContext] = await Promise.all([
      getRecentMessages(pool, conversationId, 10),
      userId ? getUserOrdersForBot(pool, userId) : Promise.resolve([]),
      buildRagContext(pool, message)
    ])

    // Detect mã đơn
    let searchedOrderContext = ''
    const match = message.match(/ORD-\d{8}-\d{4}/i)
    if (match) {
      const orderNo = match[0].toUpperCase()
      if (!userId) {
        searchedOrderContext = `\n[TRA CỨU ĐƠN HÀNG THEO YÊU CẦU]\nKhách hỏi về mã đơn: ${orderNo}\nKết quả tra cứu: Vui lòng yêu cầu khách đăng nhập để xem thông tin đơn hàng này.`
      } else {
        const searchedOrder = await getOrderByNumber(pool, orderNo, userId)
        if (searchedOrder) {
          const total = Number(searchedOrder.total).toLocaleString('vi-VN')
          const createdAt = new Date(searchedOrder.createdAt).toLocaleDateString('vi-VN')
          const itemsList = searchedOrder.items.map(i => `${i.name} (${i.color}/${i.size}) x${i.quantity} — ${Number(i.price).toLocaleString('vi-VN')}₫`).join('\n  - ')
          const paymentMethod = searchedOrder.payment?.method || 'Không rõ'
          const paymentStatusStr = searchedOrder.payment?.status === 'paid' ? 'Đã thanh toán' : 'Chưa thanh toán'

          searchedOrderContext = `\n[TRA CỨU ĐƠN HÀNG THEO YÊU CẦU]\nKhách hỏi về mã đơn: ${orderNo}\nKết quả tra cứu:\n  - Mã đơn: ${orderNo}\n  - Trạng thái: ${translateStatus(searchedOrder.status)}\n  - Tổng tiền: ${total}₫\n  - Ngày đặt: ${createdAt}\n  - Giao tới: ${searchedOrder.shipName} — ${searchedOrder.shipPhone}\n  - Địa chỉ: ${searchedOrder.shipAddress}, ${searchedOrder.shipCity}\n  - Sản phẩm: \n  - ${itemsList}\n  - Thanh toán: ${paymentMethod} — ${paymentStatusStr}\n`
        } else {
          searchedOrderContext = `\n[TRA CỨU ĐƠN HÀNG THEO YÊU CẦU]\nKhách hỏi về mã đơn: ${orderNo}\nKết quả tra cứu: Không tìm thấy đơn hàng với mã này (hoặc đơn hàng không thuộc về khách).`
        }
      }
    }

    // Lưu message của user
    await saveMessage(pool, { conversationId, role: 'user', content: message })

    // Build messages
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ]

    // Gọi Ollama API với streaming via SSE
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    let fullResponse = ''

    // Gửi conversationId về client ngay
    res.write(`data: ${JSON.stringify({ type: 'conversation_id', id: conversationId })}\n\n`)

    await ollamaChatStream({
      system: buildSystemPrompt(req.user, orders, searchedOrderContext, ragContext),
      messages,
      options: {
        stop: ["<|endoftext|>", "NHIỆM VỤ:", "QUY TẮC:", "Khách:", "Bot:", "Assistant:"],
        temperature: 0.3 // Lower temperature to reduce repetition/hallucination
      },
      onChunk: async (text) => {
        fullResponse += text
        res.write(`data: ${JSON.stringify({ type: 'text', text: sanitizeResponse(fullResponse) })}\n\n`)
      },
      onDone: async (full) => {
        const finalContent = sanitizeResponse(full) || 'Xin lỗi, em gặp chút trục trặc khi tạo câu trả lời. Anh/chị thử lại nhé!'
        if (full) {
          await saveMessage(pool, {
            conversationId,
            role: 'assistant',
            content: finalContent
          })
        }
        // Send final chunk to let frontend know it's done rendering the last bit
        res.write(`data: ${JSON.stringify({ type: 'text', text: finalContent })}\n\n`) 
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
        res.end()
      },
    })
  })
)

// GET /ai/chat/history — lấy lịch sử chat
router.get(
  '/chat/history',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id ?? null
    const sessionId = req.sessionId ?? null
    const type = req.query.type || 'support'

    const { rows } = await pool.query(
      userId
        ? `SELECT id FROM chat_conversations WHERE user_id = $1 AND type = $2 ORDER BY updated_at DESC LIMIT 1`
        : `SELECT id FROM chat_conversations WHERE session_id = $1 AND type = $2 ORDER BY updated_at DESC LIMIT 1`,
      [userId ?? sessionId, type]
    )

    if (!rows[0]) return res.json({ data: { messages: [], conversationId: null } })

    const messages = await getRecentMessages(pool, rows[0].id, 50)
    res.json({ data: { messages, conversationId: rows[0].id } })
  })
)

export default router
