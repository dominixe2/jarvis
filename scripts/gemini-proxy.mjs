/**
 * Local Gemini proxy and Windows DPAPI credential store.
 * API keys never enter the Vite bundle or get written to plaintext files.
 */
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.JARVIS_GEMINI_PORT || 8788)
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
const keyDir = join(appData, 'JARVIS')
const keyFile = join(keyDir, 'gemini-key.dpapi')
const envFile = join(process.cwd(), '.env.local')

function allowedOrigin(value) {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname) &&
      ((+u.port >= 5173 && +u.port <= 5199) || (+u.port >= 4173 && +u.port <= 4199))
  } catch { return false }
}

function runPowerShell(command, input = '') {
  if (process.platform !== 'win32') throw new Error('Bezpečné ukládání klíče je zatím dostupné pouze ve Windows.')
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    input, encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, JARVIS_GEMINI_KEY_FILE: keyFile },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error((result.stderr || 'Windows credential operation failed.').trim().slice(0, 300))
  return (result.stdout || '').trim()
}

function saveKey(key) {
  mkdirSync(keyDir, { recursive: true })
  const script = "$ErrorActionPreference='Stop'; $plain=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString -String $plain -AsPlainText -Force; $encrypted=ConvertFrom-SecureString -SecureString $secure; [Console]::Out.Write($encrypted)"
  const encrypted = runPowerShell(script, key)
  if (!encrypted) throw new Error('Windows nevrátilo zašifrovaný klíč.')
  writeFileSync(keyFile, encrypted, { encoding: 'utf8', mode: 0o600 })
}

function loadKey() {
  if (!existsSync(keyFile)) return ''
  const script = "$ErrorActionPreference='Stop'; $cipher=[System.IO.File]::ReadAllText($env:JARVIS_GEMINI_KEY_FILE); $secure=ConvertTo-SecureString -String $cipher; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }"
  return runPowerShell(script)
}

function readBackend() {
  try {
    const raw = readFileSync(envFile, 'utf8')
    const match = raw.match(/^\s*VITE_BACKEND\s*=\s*(.*?)\s*$/m)
    return match?.[1]?.replace(/^(['"])(.*)\1$/, '$2').trim() || 'bridge'
  } catch { return 'bridge' }
}

function saveBackend(backend) {
  let raw = ''
  try { raw = readFileSync(envFile, 'utf8') } catch {}
  const line = `VITE_BACKEND=${backend}`
  if (/^\s*VITE_BACKEND\s*=.*$/m.test(raw)) {
    raw = raw.replace(/^\s*VITE_BACKEND\s*=.*$/m, line)
  } else {
    raw = raw.trimEnd()
    raw += `${raw ? '\n' : ''}${line}\n`
  }
  writeFileSync(envFile, raw, 'utf8')
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

async function readJson(req, limit = 1_000_000) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw Object.assign(new Error('Request too large'), { status: 413 })
  }
  return JSON.parse(body || '{}')
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (!allowedOrigin(origin)) return sendJson(res, 403, { error: 'Přístup je povolen jen z místního rozhraní JARVIS.' })
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/api/gemini/status') {
    return sendJson(res, 200, {
      configured: existsSync(keyFile),
      secureStorage: process.platform === 'win32',
      storage: process.platform === 'win32' ? 'Windows DPAPI' : 'Windows required',
      backend: readBackend(),
    })
  }

  if (req.method === 'POST' && req.url === '/api/backend') {
    try {
      const body = await readJson(req, 16_000)
      const backend = body.backend
      if (backend !== 'bridge' && backend !== 'gemini') return sendJson(res, 400, { error: 'Vyber režim bridge nebo gemini.' })
      saveBackend(backend)
      return sendJson(res, 200, { backend, restartRequired: true })
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : 'Režim se nepodařilo uložit.' })
    }
  }

  if (req.method === 'POST' && req.url === '/api/gemini/key') {
    try {
      const body = await readJson(req, 16_000)
      const key = typeof body.key === 'string' ? body.key.trim() : ''
      if (!key) return sendJson(res, 400, { error: 'Vlož platný Gemini API klíč.' })
      if (key.length > 4096 || /[\r\n\0]/.test(key)) return sendJson(res, 400, { error: 'Formát API klíče není platný.' })
      saveKey(key)
      return sendJson(res, 200, { configured: true, secureStorage: true, storage: 'Windows DPAPI', backend: readBackend() })
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : 'Klíč se nepodařilo bezpečně uložit.' })
    }
  }

  if (req.method === 'DELETE' && req.url === '/api/gemini/key') {
    try {
      if (existsSync(keyFile)) unlinkSync(keyFile)
      return sendJson(res, 200, { configured: false, secureStorage: process.platform === 'win32', storage: process.platform === 'win32' ? 'Windows DPAPI' : 'Windows required', backend: readBackend() })
    } catch (error) {
      return sendJson(res, 500, { error: error instanceof Error ? error.message : 'Klíč se nepodařilo odebrat.' })
    }
  }

  if (req.method !== 'POST' || req.url !== '/api/gemini/stream') {
    res.writeHead(404); res.end('Not found'); return
  }

  let key
  try { key = loadKey() } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : 'Nepodařilo se načíst uložený klíč.' })
  }
  if (!key) return sendJson(res, 503, { error: 'Chybí Gemini API klíč. Otevři Nastavení a vlož ho tam.' })

  let body
  try { body = await readJson(req) } catch (error) {
    return sendJson(res, error.status || 400, { error: error instanceof Error ? error.message : 'Neplatný požadavek.' })
  }

  const controller = new AbortController()
  const abortUpstream = () => controller.abort()
  req.on('aborted', abortUpstream)
  res.on('close', () => {
    if (!res.writableEnded) abortUpstream()
  })

  try {
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
    })
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    if (!upstream.body) { res.end(); return }
    for await (const chunk of upstream.body) res.write(chunk)
    res.end()
  } catch (error) {
    if (!res.headersSent) sendJson(res, 502, { error: error instanceof Error ? error.message : 'Gemini proxy failed.' })
    else res.end()
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`[gemini-proxy] listening on http://127.0.0.1:${PORT}`))
