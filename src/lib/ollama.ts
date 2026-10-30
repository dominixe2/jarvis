import { SYSTEM_PROMPT } from '../config'
import type { AskHandlers, Msg } from './anthropic'

/**
 * Zero-cost, API-key-free local brain.
 *
 * The Ollama proxy runs on the PC and is intentionally chat-only. It does not
 * expose the PC-control endpoints to other devices on the Wi-Fi network.
 */
let active: AbortController | null = null

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: string; text: string } =>
      Boolean(part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'))
    .map((part) => part.text)
    .join('')
}

function endpoint(): string {
  const configured = import.meta.env.VITE_OLLAMA_PROXY_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  // When opened on the PC's LAN address, the phone talks back to that same PC.
  // This is a plain-LAN development path, not a public HTTPS deployment.
  const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'
  return `http://${host}:8789`
}

export async function ask(
  history: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  active?.abort()
  const controller = new AbortController()
  active = controller
  let text = ''

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: textOf(message.content),
      }))
      .filter((message) => message.content.trim().length > 0),
  ]

  try {
    const response = await fetch(`${endpoint()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, stream: true }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 503 || response.status === 502) {
        throw new Error('Místní AI neběží. Na notebooku spusť Ollama a stáhni model Qwen2.5:3b.')
      }
      throw new Error(`Místní AI vrátila HTTP ${response.status}.${detail ? ` ${detail.slice(0, 180)}` : ''}`)
    }
    if (!response.body) throw new Error('Místní AI nevrátila stream odpovědi.')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let item: { message?: { content?: string }; done?: boolean; error?: string }
        try { item = JSON.parse(line) } catch { continue }
        if (item.error) throw new Error(item.error)
        const delta = item.message?.content
        if (typeof delta === 'string' && delta) {
          text += delta
          handlers.onText(delta)
        }
      }
    }
    if (buffer.trim()) {
      try {
        const item = JSON.parse(buffer) as { message?: { content?: string }; error?: string }
        if (item.error) throw new Error(item.error)
        const delta = item.message?.content
        if (typeof delta === 'string' && delta) {
          text += delta
          handlers.onText(delta)
        }
      } catch (error) {
        if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error
      }
    }
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
  return ['Ollama local brain', 'No API key', 'No cloud']
}
