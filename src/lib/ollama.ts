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

const PAIRING_TOKEN_KEY = 'jarvis_ollama_pairing_token'

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname.endsWith('.localhost')
}

function assertSecureTransport(): void {
  if (typeof window === 'undefined') throw new Error('Párování je dostupné pouze v prohlížeči.')
  if (!window.isSecureContext && !isLoopbackHost(window.location.hostname)) {
    throw new Error('Připojení z telefonu vyžaduje HTTPS s certifikátem důvěryhodným Androidem. Přes nezabezpečené HTTP se token neposílá.')
  }
}

export function hasOllamaPairingToken(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.sessionStorage.getItem(PAIRING_TOKEN_KEY))
  } catch {
    return false
  }
}

export function saveOllamaPairingToken(value: string): void {
  assertSecureTransport()
  const token = value.trim()
  if (token.length < 32) throw new Error('Párovací token je neplatný nebo příliš krátký.')
  window.sessionStorage.setItem(PAIRING_TOKEN_KEY, token)
}

export function clearOllamaPairingToken(): void {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.removeItem(PAIRING_TOKEN_KEY) } catch { /* storage may be disabled */ }
}

function getOllamaPairingToken(): string {
  assertSecureTransport()
  let token = ''
  try { token = window.sessionStorage.getItem(PAIRING_TOKEN_KEY) || '' } catch { /* handled below */ }
  if (!token) throw new Error('JARVIS není spárovaný. Vlož jednorázový token z terminálu v Nastavení.')
  return token
}

function endpoint(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8789/api/chat'
  return window.location.origin + '/api/ollama'
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
    const token = getOllamaPairingToken()
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ messages, stream: true }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 401) throw new Error('Párovací token chybí nebo vypršel. Zkopíruj aktuální token z terminálu a znovu spáruj toto zařízení.')
      if (response.status === 403) throw new Error('Relay odmítl původ požadavku. Otevři JARVIS přes jeho povolenou HTTPS adresu.')
      if (response.status === 429) throw new Error('JARVIS omezuje počet požadavků. Chvíli počkej a zkus to znovu.')
      if (response.status === 503) throw new Error('Místní AI je vytížená nebo Ollama není dostupná. Zkontroluj terminál notebooku.')
      if (response.status === 502) throw new Error('Ollama vrátila chybu. Zkontroluj, zda je model nainstalovaný a běží.')
      throw new Error('Místní AI vrátila HTTP ' + response.status + '.' + (detail ? ' ' + detail.slice(0, 180) : ''))
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
