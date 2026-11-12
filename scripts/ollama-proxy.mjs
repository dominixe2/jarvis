/**
 * Authenticated, chat-only Ollama relay for JARVIS.
 * The relay binds to loopback; LAN clients must use the HTTPS Vite proxy.
 */
import { createServer } from 'node:http'
import {
  createConcurrencyGate,
  createPairingToken,
  createSlidingWindowLimiter,
  hasValidBearerToken,
  isAllowedOrigin,
  isValidChatPayload,
} from './ollama-security.mjs'

const PORT = Number(process.env.JARVIS_OLLAMA_PORT || 8789)
const UPSTREAM = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat'
const MODEL = process.env.JARVIS_OLLAMA_MODEL || 'qwen2.5:3b'
const MAX_BODY = 1_000_000
const PAIRING_TOKEN = createPairingToken()
const allowRequest = createSlidingWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 128 })
const upstreamSlots = createConcurrencyGate(2)

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('Požadavek je příliš velký.'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (!isAllowedOrigin(origin, req.headers.host)) {
    return json(res, 403, { error: 'Přístup je povolen pouze z povoleného rozhraní JARVIS.' })
  }

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }
  if (req.method !== 'POST' || req.url !== '/api/chat') {
    return json(res, 404, { error: 'Nenalezeno.' })
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    return json(res, 415, { error: 'Očekává se JSON.' })
  }

  // Vite proxies requests over loopback, so this is a shared per-server limit.
  if (!allowRequest(req.socket.remoteAddress || 'unknown')) {
    return json(res, 429, { error: 'Příliš mnoho požadavků. Chvíli počkej.' })
  }
  if (!hasValidBearerToken(req.headers.authorization, PAIRING_TOKEN)) {
    return json(res, 401, { error: 'Chybí platný párovací token. Vlož aktuální token z terminálu v Nastavení.' })
  }
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
    return json(res, 413, { error: 'Požadavek je příliš velký.' })
  }

  let payload
  try {
    payload = JSON.parse(await readBody(req))
  } catch (error) {
    return json(res, error.status || 400, { error: error instanceof Error ? error.message : 'Neplatný JSON.' })
  }
  if (!isValidChatPayload(payload)) {
    return json(res, 400, { error: 'Zprávy mají neplatný formát.' })
  }

  const release = upstreamSlots.tryAcquire()
  if (!release) return json(res, 503, { error: 'Místní AI je právě vytížená. Zkus to za chvíli.' })

  const controller = new AbortController()
  req.on('aborted', () => controller.abort())
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: payload.messages,
        stream: true,
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
    })
    if (!upstream.ok) {
      // Upstream error bodies can echo prompts, internal URLs or other private
      // details. Keep the client response to a safe status/category only.
      return json(res, upstream.status === 404 ? 503 : 502, {
        error: upstream.status === 404
          ? 'Model ' + MODEL + ' nebyl nalezen. Stáhni jej pomocí Ollama.'
          : 'Ollama vrátila HTTP ' + upstream.status + '. Zkontroluj místní model.',
      })
    }
    if (!upstream.body) return json(res, 502, { error: 'Ollama nevrátila stream.' })
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    for await (const chunk of upstream.body) {
      if (res.destroyed) break
      res.write(chunk)
    }
    if (!res.destroyed) res.end()
  } catch (error) {
    if (res.headersSent) return res.end()
    return json(res, 503, {
      error: error instanceof Error && error.name === 'TimeoutError'
        ? 'Místní AI odpovídá příliš dlouho.'
        : 'Ollama není dostupná. Spusť Ollama na notebooku a ověř, že běží na portu 11434.',
    })
  } finally {
    release()
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('[ollama-proxy] chat-only relay bound to 127.0.0.1:' + PORT)
  console.log('[ollama-proxy] one-launch pairing token: ' + PAIRING_TOKEN)
})
