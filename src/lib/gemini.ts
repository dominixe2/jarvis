import { SYSTEM_PROMPT } from '../config'
import type { AskHandlers, Msg } from './anthropic'

/**
 * Gemini Flash client. API credentials remain in the local Node proxy.
 * Gemini function calls are executed by a restricted, local allowlist of PC tools.
 */
let active: AbortController | null = null

type GeminiPart = {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string }
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string }
}
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }
type ToolCall = { name: string; args: Record<string, unknown>; id?: string }

const LOCAL_TOOLS = [{
  functionDeclarations: [
    {
      name: 'get_system_info',
      description: 'Read a short, non-sensitive summary of the computer OS, CPU count, memory, and uptime.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'open_application',
      description: 'Open one of the allowed Windows apps when the user asks: Notepad, Calculator, File Explorer, Task Manager, or Windows Settings.',
      parameters: {
        type: 'OBJECT',
        properties: {
          application: { type: 'STRING', enum: ['notepad', 'calculator', 'file_explorer', 'task_manager', 'settings'] },
        },
        required: ['application'],
      },
    },
    {
      name: 'open_website',
      description: 'Open a normal HTTP or HTTPS website in the default browser.',
      parameters: {
        type: 'OBJECT',
        properties: { url: { type: 'STRING', description: 'A complete http:// or https:// URL.' } },
        required: ['url'],
      },
    },
    {
      name: 'list_running_apps',
      description: 'List a limited set of running Windows processes when the user asks what is running.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'search_local_files',
      description: 'Search file names only in Desktop, Documents, or Downloads. Use only when the user asks to find a local file.',
      parameters: {
        type: 'OBJECT',
        properties: {
          folder: { type: 'STRING', enum: ['Desktop', 'Documents', 'Downloads'] },
          query: { type: 'STRING', description: 'A short name fragment to search for.' },
        },
        required: ['folder', 'query'],
      },
    },
    {
      name: 'read_text_file',
      description: 'Read a small text file explicitly requested by the user. Only Desktop, Documents, and Downloads are allowed; supported formats are TXT, MD, CSV, LOG, JSON, and XML.',
      parameters: {
        type: 'OBJECT',
        properties: { path: { type: 'STRING', description: 'The full path of the specific file the user asked to read.' } },
        required: ['path'],
      },
    },
  ],
}]

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: string; text: string } =>
      Boolean(part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'))
    .map((part) => part.text)
    .join('')
}

async function runLocalTool(call: ToolCall, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch('http://127.0.0.1:8788/api/pc/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: call.name, args: call.args }),
    signal,
  })
  const data = await response.json().catch(() => ({})) as { result?: Record<string, unknown>; error?: string }
  if (!response.ok) return { ok: false, error: data.error || `Lokální nástroj vrátil HTTP ${response.status}.` }
  return data.result ?? { ok: false, error: 'Lokální nástroj nevrátil výsledek.' }
}

export async function ask(
  history: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  active?.abort()
  const controller = new AbortController()
  active = controller
  let fullText = ''
  const usedTools: string[] = []

  const contents: GeminiContent[] = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: messageText(message.content) }],
    }))
    .filter((message) => message.parts[0].text?.trim().length)

  try {
    // A bounded tool loop prevents a model from chaining local actions forever.
    for (let round = 0; round < 5; round++) {
      const response = await fetch('http://127.0.0.1:8788/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          tools: LOCAL_TOOLS,
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        let message = `Gemini API vrátilo chybu HTTP ${response.status}.`
        try {
          const parsed = JSON.parse(detail)
          message = parsed?.error?.message || parsed?.error || message
        } catch {
          if (detail) message += ` ${detail.slice(0, 300)}`
        }
        throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
      }

      if (!response.body) throw new Error('Gemini API nevrátilo stream odpovědi.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let roundText = ''
      const calls = new Map<string, ToolCall>()

      const consume = (payload: string) => {
        if (!payload || payload === '[DONE]') return
        const chunk = JSON.parse(payload)
        const parts = chunk.candidates?.[0]?.content?.parts ?? []
        for (const part of parts as GeminiPart[]) {
          if (typeof part.text === 'string' && part.text) {
            roundText += part.text
            fullText += part.text
            handlers.onText(part.text)
          }
          if (part.functionCall?.name) {
            const call = part.functionCall
            const existing = calls.get(call.name)
            calls.set(call.name, {
              name: call.name,
              args: { ...(existing?.args ?? {}), ...(call.args ?? {}) },
              ...(call.id ? { id: call.id } : existing?.id ? { id: existing.id } : {}),
            })
          }
        }
        if (chunk.candidates?.[0]?.finishReason === 'SAFETY') {
          throw new Error('Gemini odpověď zablokovalo bezpečnostní filtrování.')
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          consume(line.slice(5).trim())
        }
      }
      if (buffer.startsWith('data:')) consume(buffer.slice(5).trim())

      const functionCalls = [...calls.values()]
      if (!functionCalls.length) break

      contents.push({
        role: 'model',
        parts: [
          ...(roundText ? [{ text: roundText }] : []),
          ...functionCalls.map((call) => ({ functionCall: { name: call.name, args: call.args, ...(call.id ? { id: call.id } : {}) } })),
        ],
      })

      const functionResponses: GeminiPart[] = []
      for (const call of functionCalls) {
        if (controller.signal.aborted) break
        handlers.onTool(call.name)
        usedTools.push(call.name)
        let result: Record<string, unknown>
        try {
          result = await runLocalTool(call, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) break
          result = { ok: false, error: error instanceof Error ? error.message : 'Lokální nástroj se nepodařilo spustit.' }
        }
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: result,
            ...(call.id ? { id: call.id } : {}),
          },
        })
      }
      if (controller.signal.aborted) break
      contents.push({ role: 'user', parts: functionResponses })
    }

    if (controller.signal.aborted) return { text: fullText.trim(), tools: usedTools }
    if (!fullText.trim()) throw new Error('Gemini vrátilo prázdnou odpověď. Zkontroluj klíč, model a kvótu.')
    return { text: fullText.trim(), tools: usedTools }
  } catch (error) {
    if (controller.signal.aborted) return { text: fullText.trim(), tools: usedTools }
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
  return ['Gemini 3.8 Flash', 'Local PC tools']
}
