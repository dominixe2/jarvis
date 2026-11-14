/**
 * Authenticated, chat-only Ollama relay for JARVIS.
 * Pairing codes are shown only by a loopback status page; browser sessions use
 * HttpOnly cookies and are never exposed to JavaScript or Web Storage.
 */
import { createServer } from 'node:http'
import {
  createConcurrencyGate,
  createPairingCode,
  createSessionToken,
  createSlidingWindowLimiter,
  hashSessionToken,
  isAllowedOrigin,
  isValidChatPayload,
  safeEqualText,
} from './ollama-security.mjs'

const PORT = Number(process.env.JARVIS_OLLAMA_PORT || 8789)
const STATUS_PORT = Number(process.env.JARVIS_OLLAMA_STATUS_PORT || 0)
const UPSTREAM = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat'
const MODEL = process.env.JARVIS_OLLAMA_MODEL || 'qwen2.5:3b'
const MAX_BODY = 1_000_000
const PAIRING_TTL_MS = 5 * 60_000
const SESSION_TTL_MS = 12 * 60 * 60_000
const COOKIE_NAME = 'jarvis_ollama_session'

let pairingCode = createPairingCode()
let pairingExpiresAt = Date.now() + PAIRING_TTL_MS
let pairingConsumed = false
const sessions = new Map()
const allowPairing = createSlidingWindowLimiter({ limit: 5, windowMs: 5 * 60_000, maxKeys: 128 })
const allowRequest = createSlidingWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 128 })
const upstreamSlots = createConcurrencyGate(2)

function rotatePairingCode() {
  pairingCode = createPairingCode()
  pairingExpiresAt = Date.now() + PAIRING_TTL_MS
  pairingConsumed = false
}

function readCookie(req, name) {
  const prefix = name + '='
  for (const part of String(req.headers.cookie || '').split(';')) {
    const item = part.trim()
    if (item.startsWith(prefix)) return item.slice(prefix.length)
  }
  return ''
}

function hasValidSession(req) {
  const token = readCookie(req, COOKIE_NAME)
  if (!token || token.length > 128) return false
  const hash = hashSessionToken(token)
  const expiresAt = sessions.get(hash)
  if (!expiresAt) return false
  if (expiresAt <= Date.now()) {
    sessions.delete(hash)
    if (sessions.size === 0 && pairingConsumed) rotatePairingCode()
    return false
  }
  return true
}

function json(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
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

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function cookieOptions(origin, maxAge) {
  let secure = false
  try { secure = new URL(origin).protocol === 'https:' } catch { /* origin was already validated */ }
  return [
    COOKIE_NAME + '=',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + maxAge,
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

const PAIRING_PAGE = `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JARVIS · Místní párování</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#07111f;color:#eaf2ff}
body{min-height:100vh;margin:0;display:grid;place-items:center;padding:20px;box-sizing:border-box}
main{width:min(500px,100%);padding:28px;border:1px solid #284564;border-radius:20px;background:#101d30;box-shadow:0 20px 70px #0008}
h1{font-size:23px;margin:0 0 8px}p{color:#aabbd0;line-height:1.55}
code{display:block;margin:22px 0;padding:20px;border-radius:14px;background:#07111f;color:#55e5d1;font-size:clamp(32px,10vw,48px);font-weight:800;letter-spacing:.2em;text-align:center}
#state{font-weight:650;color:#9be8d7}small{color:#8297b0}
</style></head><body><main><h1>JARVIS · Bezpečné párování</h1>
<p>Jednorázový kód je dostupný pouze v tomto notebooku. Zadej jej v Nastavení JARVIS na telefonu, který je připojený ke stejné Wi-Fi.</p>
<code id="code">Načítám…</code><p id="state" role="status">Kontroluji stav…</p>
<small id="expiry">Kód platí pět minut, použije se pouze jednou a nikam se neukládá.</small></main>
<script>
async function refresh(){const code=document.getElementById('code'),state=document.getElementById('state'),expiry=document.getElementById('expiry');try{const response=await fetch('/status',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw new Error('status unavailable');const data=await response.json();code.textContent=data.pairing_code||'Kód není dostupný';state.textContent=data.consumed?'Kód již byl použit.':(data.pairing_code?'Čekám na spárování telefonu.':'Kód vypršel.');expiry.textContent=data.pairing_code?'Platnost přibližně '+data.expires_in+' s.':'Restartuj nebo odpoj relaci pro nový kód.'}catch{code.textContent='Nedostupné';state.textContent='Místní párovací stránku se nepodařilo načíst.'}}
refresh();setInterval(refresh,1000);
</script></body></html>`

const statusServer = createServer((req, res) => {
  const port = statusServer.address()?.port
  const allowedHosts = new Set(['127.0.0.1:' + port, 'localhost:' + port])
  if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) {
    res.writeHead(403, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    return res.end('Forbidden')
  }
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    res.writeHead(403, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    return res.end('Forbidden')
  }
  const origin = req.headers.origin
  const allowedOrigins = new Set(['http://127.0.0.1:' + port, 'http://localhost:' + port])
  if (origin && !allowedOrigins.has(origin)) {
    res.writeHead(403, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    return res.end('Forbidden')
  }
  const path = new URL(req.url || '/', 'http://localhost').pathname
  const headers = {
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
  }
  if (req.method !== 'GET') {
    res.writeHead(405, headers)
    return res.end('Method not allowed')
  }
  if (path === '/') {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(PAIRING_PAGE)
  }
  if (path === '/status') {
    if (pairingExpiresAt <= Date.now() && !pairingConsumed && sessions.size === 0) rotatePairingCode()
    const remaining = pairingConsumed ? 0 : Math.max(0, Math.floor((pairingExpiresAt - Date.now()) / 1000))
    const value = {
      pairing_code: !pairingConsumed && remaining > 0 ? pairingCode : null,
      expires_in: remaining,
      consumed: pairingConsumed,
    }
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify(value))
  }
  res.writeHead(404, headers)
  res.end('Not found')
})

statusServer.listen(STATUS_PORT, '127.0.0.1', () => {
  console.log('[ollama-proxy] local pairing page: http://127.0.0.1:' + statusServer.address().port)
})

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (!isAllowedOrigin(origin, req.headers.host)) {
    return json(res, 403, { error: 'Přístup je povolen pouze ze stejného povoleného rozhraní JARVIS.' })
  }
  res.setHeader('Vary', 'Origin')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    })
    return res.end()
  }
  if (req.method !== 'POST' || !['/api/pair', '/api/status', '/api/unpair', '/api/chat'].includes(req.url || '')) {
    return json(res, 404, { error: 'Nenalezeno.' })
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    return json(res, 415, { error: 'Očekává se JSON.' })
  }

  if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
    return json(res, 413, { error: 'Požadavek je příliš velký.' })
  }

  if (req.url === '/api/status') {
    try { await readBody(req) } catch { return json(res, 413, { error: 'Požadavek je příliš velký.' }) }
    return json(res, 200, { paired: hasValidSession(req) })
  }

  if (req.url === '/api/pair') {
    const remote = req.socket.remoteAddress || 'unknown'
    if (!allowPairing(remote)) return json(res, 429, { error: 'Příliš mnoho pokusů o párování. Chvíli počkej.' })
    let originUrl
    try { originUrl = new URL(origin) } catch { return json(res, 403, { error: 'Párování vyžaduje ověřený původ.' }) }
    if (originUrl.protocol !== 'https:' && !isLoopbackHostname(originUrl.hostname)) {
      return json(res, 403, { error: 'Párování z telefonu vyžaduje HTTPS s důvěryhodným certifikátem.' })
    }
    let body
    try { body = parseJson(await readBody(req)) } catch (error) { return json(res, error.status || 400, { error: 'Neplatný požadavek.' }) }
    if (!body || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
      return json(res, 400, { error: 'Zadej šestimístný párovací kód.' })
    }
    if (pairingConsumed) return json(res, 409, { error: 'Párovací kód už byl použit.' })
    if (pairingExpiresAt <= Date.now() || !safeEqualText(body.code, pairingCode)) {
      return json(res, 401, { error: 'Párovací kód je neplatný nebo vypršel.' })
    }
    pairingConsumed = true
    const sessionToken = createSessionToken()
    sessions.set(hashSessionToken(sessionToken), Date.now() + SESSION_TTL_MS)
    const setCookie = cookieOptions(origin, Math.floor(SESSION_TTL_MS / 1000)).replace(COOKIE_NAME + '=', COOKIE_NAME + '=' + sessionToken)
    return json(res, 200, { paired: true }, { 'Set-Cookie': setCookie })
  }

  if (req.url === '/api/unpair') {
    try { await readBody(req) } catch { return json(res, 413, { error: 'Požadavek je příliš velký.' }) }
    const token = readCookie(req, COOKIE_NAME)
    if (token) sessions.delete(hashSessionToken(token))
    if (sessions.size === 0) rotatePairingCode()
    const clearCookie = cookieOptions(origin, 0)
    return json(res, 200, { paired: false }, { 'Set-Cookie': clearCookie })
  }

  if (!allowRequest(req.socket.remoteAddress || 'unknown')) {
    return json(res, 429, { error: 'Příliš mnoho požadavků. Chvíli počkej.' })
  }
  if (!hasValidSession(req)) {
    return json(res, 401, { error: 'Zařízení není spárované nebo relace vypršela.' })
  }

  let payload
  try {
    payload = parseJson(await readBody(req))
  } catch (error) {
    return json(res, error.status || 400, { error: 'Neplatný JSON.' })
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
      body: JSON.stringify({ model: MODEL, messages: payload.messages, stream: true }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
    })
    if (!upstream.ok) {
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
})
