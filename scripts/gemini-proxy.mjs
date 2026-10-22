/**
 * Local Gemini proxy. The API key is read only by Node from .env.local and is
 * never inlined into Vite's browser bundle. Bind exclusively to loopback.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

function readLocalKey() {
  if (process.env.GEMINI_API_KEY?.trim()) return process.env.GEMINI_API_KEY.trim()
  try {
    const file = readFileSync('.env.local', 'utf8')
    for (const line of file.split(/\r?\n/)) {
      const match = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.*?)\s*$/)
      if (match) return match[1].replace(/^(['"])(.*)\1$/, '$2').trim()
    }
  } catch {}
  return ''
}

const PORT = Number(process.env.JARVIS_GEMINI_PORT || 8788)
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
function allowedOrigin(value) {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname) &&
      ((+u.port >= 5173 && +u.port <= 5199) || (+u.port >= 4173 && +u.port <= 4199))
  } catch { return false }
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (!allowedOrigin(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Local JARVIS origin required.' }))
    return
  }
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST' || req.url !== '/api/gemini/stream') {
    res.writeHead(404); res.end('Not found'); return
  }

  const key = readLocalKey()
  if (!key) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Chybí GEMINI_API_KEY v .env.local. Klíč není potřeba prefixovat VITE_.' }))
    return
  }

  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1_000_000) {
      res.writeHead(413); res.end('Request too large'); return
    }
  }

  try {
    JSON.parse(body)
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: AbortSignal.timeout(120_000),
    })
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    if (!upstream.body) { res.end(); return }
    for await (const chunk of upstream.body) res.write(chunk)
    res.end()
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Gemini proxy failed.' }))
    } else res.end()
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`[gemini-proxy] listening on http://127.0.0.1:${PORT}`))
