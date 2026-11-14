import { SYSTEM_PROMPT } from '../config'
import type { AskHandlers, Msg } from './anthropic'

/**
 * Zero-cost, API-key-free local brain.
 *
 * The Ollama proxy runs on the PC and is intentionally chat-only. Pairing uses
 * a one-time code exchanged for an HttpOnly cookie; JavaScript never reads,
 * writes or sends a bearer token.
 */
let active: AbortController | null = null

// Remove the obsolete per-tab bearer token from the previous implementation.
if (typeof window !== 'undefined') {
  try { window.sessionStorage.removeItem('jarvis_ollama_pairing_token') } catch { /* storage may be disabled */ }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: string; text: string } =>
      Boolean(part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'))
    .map((part) => part.text)
    .join('')
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname.endsWith('.localhost')
}

function assertSecureTransport(): void {
  if (typeof window === 'undefined') throw new Error('Párování je dostupné pouze v prohlížeči.')
  if (!window.isSecureContext && !isLoopbackHost(window.location.hostname)) {
    throw new Error('Připojení z telefonu vyžaduje HTTPS s certifikátem důvěryhodným Androidem. Přes nezabezpečené HTTP se párovací kód neposílá.')
  }
}

function endpoint(path: string): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8789/api/' + path
  return window.location.origin + '/api/ollama/' + path
}

async function post(path: string, body: unknown = {}): Promise<Response> {
  assertSecureTransport()
  return fetch(endpoint(path), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function checkOllamaPairing(): Promise<boolean> {
  const response = await post('status')
  if (!response.ok) return false
  const data = await response.json().catch(() => ({})) as { paired?: boolean }
  return data.paired === true
}

export async function pairOllama(code: string): Promise<void> {
  const normalized = code.trim()
  if (!/^\d{6}$/.test(normalized)) throw new Error('Párovací kód musí mít přesně šest číslic.')
  const response = await post('pair', { code: normalized })
  const data = await response.json().catch(() => ({})) as { error?: string; paired?: boolean }
  if (!response.ok || data.paired !== true) {
    throw new Error(data.error || 'Párování se nepodařilo. Zkontroluj platnost kódu a HTTPS připojení.')
  }
}

export async function unpairOllama(): Promise<void> {
  const response = await post('unpair')
  if (!response.ok) throw new Error('Zařízení se nepodařilo odpojit.')
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
    { role: 'system', content: SYSTEM_PROMPT + '\n\nDŮLEŽITÉ PRO TENTO REŽIM: Běžíš jako lokální chat bez nástrojů. Nemáš přístup k souborům, aplikacím, internetu ani ovládání PC. Nikdy netvrď, že jsi něco provedl na zařízení, pokud jsi pouze popsal postup. Odpovídej česky, pokud uživatel nepoužije jiný jazyk.' },
    ...history
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: textOf(message.content),
      }))
      .filter((message) => message.content.trim().length > 0),
  ]

  try {
    const response = await fetch(endpoint('chat'), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, stream: true }),
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 401) throw new Error('Zařízení není spárované nebo relace vypršela. Otevři místní párovací stránku na notebooku a zadej nový kód.')
      if (response.status === 403) throw new Error('Relay odmítl původ požadavku. Otevři JARVIS přes jeho povolenou HTTPS adresu.')
      if (response.status === 429) throw new Error('JARVIS omezuje počet požadavků. Chvíli počkej a zkus to znovu.')
      if (response.status === 503) throw new Error('Místní AI je vytížená nebo Ollama není dostupná. Zkontroluj terminál notebooku.')
      if (response.status === 502) throw new Error('Ollama vrátila chybu. Zkontroluj, zda je model nainstalovaný a běží.')
      throw new Error('Místní AI vrátila HTTP ' + response.status + '.')
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
  return ['Ollama local brain', 'No API key', 'HttpOnly paired session']
}
