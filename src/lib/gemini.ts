import { env, SYSTEM_PROMPT } from '../config'
import type { AskHandlers, Msg } from './anthropic'

/**
 * Local testing backend for Gemini Flash. The key is read from VITE_GEMINI_API_KEY
 * and therefore is included in the local browser bundle. Use only on localhost;
 * never deploy this mode or commit a real key.
 */
const MODEL = 'gemini-2.5-flash'
let active: AbortController | null = null

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: string; text: string } =>
      Boolean(part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'))
    .map((part) => part.text)
    .join('')
}

export async function ask(
  history: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  if (!env.geminiKey) {
    throw new Error('Chybí Gemini API klíč. Do souboru .env.local nastav VITE_BACKEND=gemini a VITE_GEMINI_API_KEY=tvůj_klíč, potom JARVIS restartuj.')
  }

  active?.abort()
  const controller = new AbortController()
  active = controller
  let text = ''

  const contents = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: messageText(message.content) }],
    }))
    .filter((message) => message.parts[0].text.trim().length > 0)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.geminiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      let message = `Gemini API vrátilo chybu HTTP ${response.status}.`
      try {
        const parsed = JSON.parse(detail)
        message = parsed?.error?.message || message
      } catch {
        if (detail) message += ` ${detail.slice(0, 300)}`
      }
      throw new Error(message)
    }

    if (!response.body) throw new Error('Gemini API nevrátilo stream odpovědi.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        const chunk = JSON.parse(payload)
        const delta = (chunk.candidates?.[0]?.content?.parts ?? [])
          .map((part: { text?: string }) => part.text ?? '')
          .join('')
        if (delta) {
          text += delta
          handlers.onText(delta)
        }
        const finishReason = chunk.candidates?.[0]?.finishReason
        if (finishReason === 'SAFETY') {
          throw new Error('Gemini odpověď zablokovalo bezpečnostní filtrování.')
        }
      }
    }

    if (buffer.startsWith('data:')) {
      const payload = buffer.slice(5).trim()
      if (payload && payload !== '[DONE]') {
        const chunk = JSON.parse(payload)
        const delta = (chunk.candidates?.[0]?.content?.parts ?? [])
          .map((part: { text?: string }) => part.text ?? '')
          .join('')
        if (delta) {
          text += delta
          handlers.onText(delta)
        }
      }
    }

    if (!text.trim()) throw new Error('Gemini vrátilo prázdnou odpověď. Zkontroluj klíč, model a kvótu.')
    return { text: text.trim(), tools: [] }
  } catch (error) {
    if (controller.signal.aborted) return { text: text.trim(), tools: [] }
    throw error
  } finally {
    if (active === controller) active = null
  }
}

export function cancel(): void {
  active?.abort()
  active = null
}

export function connectedLabels(): string[] {
  return env.geminiKey ? ['Gemini Flash API'] : ['Gemini API key missing']
}
