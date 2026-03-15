import { OLLAMA_URL } from '../config/env.js'

const OLLAMA_MODEL = 'qwen2.5:7b'
const OLLAMA_HEADERS = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
}

/**
 * Non-streaming chat — dùng cho Stylist Bot (cần parse JSON)
 */
export async function ollamaChat({ system, messages, maxTokens = 512, temperature = 0.7 }) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: OLLAMA_HEADERS,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: false,
      options: { num_predict: maxTokens, temperature },
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.message?.content || ''
}

/**
 * Streaming chat — dùng cho Support Bot (SSE)
 * onChunk(text): gọi mỗi khi có text mới
 * onDone(fullText): gọi khi xong
 */
export async function ollamaChatStream({ system, messages, maxTokens = 1024, temperature = 0.7, onChunk, onDone }) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: OLLAMA_HEADERS,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: true,
      options: { num_predict: maxTokens, temperature },
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean)

    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        if (data.message?.content) {
          fullText += data.message.content
          await onChunk(data.message.content)
        }
        if (data.done) {
          await onDone(fullText)
        }
      } catch {}
    }
  }

  return fullText
}
