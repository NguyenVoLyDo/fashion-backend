import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchFaqs } from '../queries/faq.queries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedKnowledgeBase = null;

export function loadKnowledgeBase() {
  if (cachedKnowledgeBase !== null) return cachedKnowledgeBase;
  try {
    const kbPath = path.resolve(__dirname, '../../data/knowledge.md');
    cachedKnowledgeBase = fs.readFileSync(kbPath, 'utf8');
  } catch (err) {
    console.error('Error loading knowledge base:', err);
    cachedKnowledgeBase = '';
  }
  return cachedKnowledgeBase;
}

const STOP_WORDS = new Set([
  'tôi', 'của', 'là', 'có', 'không', 'cho', 'được', 'và', 'hoặc', 'thì', 'mà', 'nhưng',
  'các', 'những', 'một', 'cái', 'này', 'kia', 'đó', 'đây', 'đi', 'lại', 'ra', 'vào',
  'rất', 'quá', 'lắm', 'hơi', 'bị', 'bởi', 'với', 'như', 'bằng', 'để', 'về', 'từ', 'tới',
  'cho', 'hỏi', 'làm', 'sao', 'thế', 'nào', 'ai', 'gì', 'ở', 'đâu', 'khi'
]);

export async function searchFaqContext(pool, userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return '';
  
  // Trích xuất keywords (bỏ dấu câu và stop words tiếng Việt)
  const words = userMessage.toLowerCase()
    .replace(/[^\w\s\u00C0-\u1EF9]/g, ' ') 
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  
  // Giới hạn 5 từ khóa để query DB khỏi quá tải
  const topWords = words.slice(0, 5);
  if (topWords.length === 0) return '';

  const results = [];
  const seenIds = new Set();

  for (const word of topWords) {
    const faqs = await searchFaqs(pool, word);
    for (const faq of faqs) {
      if (!seenIds.has(faq.id)) {
        seenIds.add(faq.id);
        results.push(faq);
      }
    }
  }

  // Ưu tiên hiển thị top 3 FAQ khớp
  const topFaqs = results.slice(0, 3);
  if (topFaqs.length === 0) return '';

  return topFaqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
}

export async function buildRagContext(pool, userMessage) {
  const staticKb = loadKnowledgeBase();
  const dynamicFaqs = await searchFaqContext(pool, userMessage);

  let context = '';
  if (dynamicFaqs) {
    context += `[CÁC CÂU HỎI FAQ KHỚP VỚI INTENT CỦA KHÁCH]\n${dynamicFaqs}\n\n`;
  }
  if (staticKb) {
    context += `[CHÍNH SÁCH CHUNG]\n${staticKb}`;
  }

  return context.trim();
}
