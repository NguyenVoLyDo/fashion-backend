import { Router } from 'express'
import asyncHandler from '../middleware/async-handler.js'
import optionalAuth from '../middleware/optional-auth.js'
import pool from '../config/db.js'
import { ollamaChatStream } from '../lib/ollama.js'
import {
  getOrCreateConversation,
  getRecentMessages,
  saveMessage,
  getUserOrdersForBot,
} from '../queries/chat.queries.js'

const router = Router()

// System prompt cho Support Bot
function buildSystemPrompt(user, orders) {
  const orderContext = orders.length > 0
    ? `\n\nĐơn hàng gần đây của khách:\n${orders.map(o => `
- Mã đơn: ${o.orderNo}
  Trạng thái: ${translateStatus(o.status)}
  Tổng tiền: ${Number(o.total).toLocaleString('vi-VN')}₫
  Ngày đặt: ${new Date(o.createdAt).toLocaleDateString('vi-VN')}
  Sản phẩm: ${o.items.map(i => `${i.name} (${i.color}/${i.size}) x${i.quantity}`).join(', ')}
`).join('')}`
    : '\n\nKhách chưa có đơn hàng nào.'

  const userContext = user
    ? `\nKhách hàng đang đăng nhập: ${user.fullName || user.email}`
    : '\nKhách chưa đăng nhập.'

  return `Bạn là trợ lý CSKH của Fashion Store — một cửa hàng thời trang online tại Việt Nam.
${userContext}
${orderContext}

NHIỆM VỤ CỦA BẠN:
- Trả lời câu hỏi về đơn hàng, sản phẩm, chính sách
- Hỗ trợ tra cứu trạng thái đơn hàng
- Giải quyết khiếu nại và thắc mắc
- Tư vấn sản phẩm phù hợp

CHÍNH SÁCH CỬA HÀNG:
- Miễn phí vận chuyển đơn từ 500.000₫
- Phí ship: 30.000₫ cho đơn dưới 500.000₫
- Đổi trả trong 7 ngày kể từ ngày nhận hàng
- Sản phẩm còn nguyên tem mác, chưa qua sử dụng
- Hoàn tiền trong 3-5 ngày làm việc

TRẠNG THÁI ĐƠN HÀNG:
- Chờ xác nhận → Đã xác nhận → Đang xử lý → Đang giao → Đã giao → Hoàn thành
- Huỷ đơn chỉ được khi trạng thái "Chờ xác nhận"

QUY TẮC TRẢ LỜI:
- Luôn dùng tiếng Việt, thân thiện, ngắn gọn
- Xưng "em", gọi khách là "anh/chị"
- Nếu không biết → hướng dẫn liên hệ hotline: 1800-xxxx
- Không bịa thông tin về đơn hàng không có trong context
- Trả lời tối đa 3-4 câu, trừ khi cần giải thích chi tiết`
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
      || await getOrCreateConversation(pool, { userId, sessionId })

    // Load history + user orders
    const [history, orders] = await Promise.all([
      getRecentMessages(pool, conversationId, 10),
      userId ? getUserOrdersForBot(pool, userId) : Promise.resolve([]),
    ])

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
    res.write(`data: ${JSON.stringify({ type: 'conversation_id', conversationId })}\n\n`)

    await ollamaChatStream({
      system: buildSystemPrompt(req.user, orders),
      messages,
      maxTokens: 1024,
      onChunk: async (text) => {
        res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`)
        fullResponse += text
      },
      onDone: async (full) => {
        await saveMessage(pool, {
          conversationId,
          role: 'assistant',
          content: full,
        })
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

    const { rows } = await pool.query(
      userId
        ? `SELECT id FROM chat_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`
        : `SELECT id FROM chat_conversations WHERE session_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [userId ?? sessionId]
    )

    if (!rows[0]) return res.json({ data: { messages: [], conversationId: null } })

    const messages = await getRecentMessages(pool, rows[0].id, 50)
    res.json({ data: { messages, conversationId: rows[0].id } })
  })
)

export default router
