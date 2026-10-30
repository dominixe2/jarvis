/**
 * LAN-safe, chat-only Ollama relay for JARVIS.
 * It exposes no filesystem, shell, or PC-control tools. It only forwards chat
 * requests to Ollama on this same PC. Do not port-forward this service.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.JARVIS_OLLAMA_PORT || 8789)
const UPSTREAM = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat'
const MAX_BODY = 1_000_000

function allowedOrigin(origin, hostHeader) {
  if (!origin || !hostHeader) return false
  let originUrl
  let requestUrl
  try {
    originUrl = new URL(origin)
    requestUrl = new URL('http://' + hostHeader)
  } catch {
    return false
  }
  if (originUrl.protocol !== 'http:') return false
  if (originUrl.hostname !== requestUrl.hostname) return false
  const port = Number(originUrl.port)
  return (port >= 5173 && port <= 5199) || (port >= 4173 && port <= 4199)
}

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
  if (!allowedOrigin(origin, req.headers.host)) {
    return json(res, 403, { error: 'Přístup je povolen jen z místního rozhraní JARVIS na stejné síti.' })
  }

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

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

  let payload
  try {
    payload = JSON.parse(await readBody(req))
  } catch (error) {
    return json(res, error.status || 400, { error: error instanceof Error ? error.message : 'Neplatný JSON.' })
  }
  if (!Array.isArray(payload.messages) || payload.messages.length > 100 ||
      payload.messages.some((m) => !m || !['system', 'user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' || m.content.length > 100_000)) {
    return json(res, 400, { error: 'Zprávy mají neplatný formát.' })
  }

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
        model: process.env.JARVIS_OLLAMA_MODEL || 'qwen2.5:3b',
        messages: payload.messages,
        stream: true,
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
    })
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      return json(res, upstream.status === 404 ? 503 : 502, {
        error: upstream.status === 404
          ? 'Model Qwen2.5:3b nenalezen. Na notebooku spusť: ollama pull qwen2.5:3b'
          : 'Ollama vrátila HTTP ' + upstream.status + (detail ? '. ' + detail.slice(0, 180) : ''),
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
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log('[ollama-proxy] chat-only relay listening on port ' + PORT + '; upstream is ' + UPSTREAM)
  console.log('[ollama-proxy] Do not expose this port to the public internet.')
})
