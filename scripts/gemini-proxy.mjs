/**
 * Local Gemini proxy and Windows DPAPI credential store.
 * API keys never enter the Vite bundle or get written to plaintext files.
 */
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { cpus, freemem, homedir, platform, release, totalmem, uptime } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

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

const DPAPI_SOURCE = String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class JarvisDpapi {
  [StructLayout(LayoutKind.Sequential)]
  private struct DATA_BLOB { public int cbData; public IntPtr pbData; }
  [DllImport("crypt32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  private static extern bool CryptProtectData(ref DATA_BLOB input, string description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref DATA_BLOB output);
  [DllImport("crypt32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  private static extern bool CryptUnprotectData(ref DATA_BLOB input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref DATA_BLOB output);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern IntPtr LocalFree(IntPtr memory);
  public static byte[] Protect(byte[] data) { return Transform(data, true); }
  public static byte[] Unprotect(byte[] data) { return Transform(data, false); }
  private static byte[] Transform(byte[] data, bool protect) {
    DATA_BLOB input = new DATA_BLOB();
    DATA_BLOB output = new DATA_BLOB();
    input.cbData = data.Length;
    input.pbData = Marshal.AllocHGlobal(data.Length);
    try {
      Marshal.Copy(data, 0, input.pbData, data.Length);
      bool ok = protect
        ? CryptProtectData(ref input, "JARVIS Gemini API key", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, ref output)
        : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, ref output);
      if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
      byte[] result = new byte[output.cbData];
      Marshal.Copy(output.pbData, result, 0, output.cbData);
      return result;
    } finally {
      if (input.pbData != IntPtr.Zero) Marshal.FreeHGlobal(input.pbData);
      if (output.pbData != IntPtr.Zero) LocalFree(output.pbData);
    }
  }
}`
function dpapiScript(body) {
  return `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
${DPAPI_SOURCE}
'@
${body}`
}

function saveKey(key) {
  mkdirSync(keyDir, { recursive: true })
  const script = dpapiScript("$plain=[Console]::In.ReadToEnd(); $bytes=[System.Text.Encoding]::UTF8.GetBytes($plain); $cipher=[JarvisDpapi]::Protect($bytes); [Console]::Out.Write([Convert]::ToBase64String($cipher))")
  const encrypted = runPowerShell(script, key)
  if (!encrypted) throw new Error('Windows nevrátilo zašifrovaný klíč.')
  writeFileSync(keyFile, encrypted, { encoding: 'utf8', mode: 0o600 })
}

function loadKey() {
  if (!existsSync(keyFile)) return ''
  const script = dpapiScript("$cipher=[Convert]::FromBase64String([System.IO.File]::ReadAllText($env:JARVIS_GEMINI_KEY_FILE)); $plain=[JarvisDpapi]::Unprotect($cipher); [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))")
  return runPowerShell(script)
}

function readBackend() {
  try {
    const raw = readFileSync(envFile, 'utf8')
    const match = raw.match(/^\s*VITE_BACKEND\s*=\s*(.*?)\s*$/m)
    return match?.[1]?.replace(/^(['"])(.*)\1$/, '$2').trim() || 'gemini'
  } catch { return 'gemini' }
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

const PC_APPS = {
  notepad: { executable: 'notepad.exe', args: [] },
  calculator: { executable: 'calc.exe', args: [] },
  file_explorer: { executable: 'explorer.exe', args: [] },
  task_manager: { executable: 'taskmgr.exe', args: [] },
  settings: { executable: 'explorer.exe', args: ['ms-settings:'] },
}

function launchProcess(executable, args) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', rejectLaunch)
    child.once('spawn', () => {
      child.unref()
      resolveLaunch({ ok: true, message: 'Aplikace byla spuštěna.' })
    })
  })
}

function allowedFileRoots() {
  return ['Desktop', 'Documents', 'Downloads'].map((name) => join(homedir(), name))
}

function insideRoot(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

async function safeFilePath(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) {
    throw Object.assign(new Error('Zadej platnou cestu k souboru.'), { status: 400 })
  }
  const candidate = resolve(input)
  const root = allowedFileRoots().find((item) => insideRoot(resolve(item), candidate))
  if (!root) throw Object.assign(new Error('Přístup je omezen na Plochu, Dokumenty a Stažené soubory.'), { status: 403 })
  const actualRoot = await realpath(root).catch(() => resolve(root))
  const actual = await realpath(candidate)
  if (!insideRoot(actualRoot, actual)) throw Object.assign(new Error('Cesta vede mimo povolenou složku.'), { status: 403 })
  return actual
}

async function searchFiles(folder, query) {
  if (!['Desktop', 'Documents', 'Downloads'].includes(folder)) {
    throw Object.assign(new Error('Prohledávat lze jen Plochu, Dokumenty a Stažené soubory.'), { status: 400 })
  }
  if (typeof query !== 'string' || !query.trim() || query.length > 120) {
    throw Object.assign(new Error('Zadej krátký hledaný výraz.'), { status: 400 })
  }
  const root = join(homedir(), folder)
  const needle = query.toLocaleLowerCase()
  const results = []
  async function walk(dir, depth) {
    if (depth > 3 || results.length >= 40) return
    let entries
    try { entries = await (await import('node:fs/promises')).readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (results.length >= 40) break
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isFile() && entry.name.toLocaleLowerCase().includes(needle)) results.push(full)
      else if (entry.isDirectory()) await walk(full, depth + 1)
    }
  }
  await walk(root, 0)
  return { folder, count: results.length, results }
}

async function runPcTool(name, args = {}) {
  if (name === 'get_system_info') {
    const total = totalmem()
    const free = freemem()
    return {
      platform: platform(),
      osVersion: release(),
      cpuCores: cpus().length,
      memoryTotalGiB: Math.round(total / 1024 ** 3 * 10) / 10,
      memoryFreeGiB: Math.round(free / 1024 ** 3 * 10) / 10,
      uptimeHours: Math.round(uptime() / 360) / 10,
    }
  }
  if (name === 'open_website') {
    if (process.platform !== 'win32') throw Object.assign(new Error('Otevírání webu přes Windows je dostupné jen ve Windows.'), { status: 501 })
    if (typeof args.url !== 'string' || args.url.length > 2048) throw Object.assign(new Error('Adresa webu není platná.'), { status: 400 })
    let url
    try { url = new URL(args.url) } catch { throw Object.assign(new Error('Adresa webu není platná.'), { status: 400 }) }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw Object.assign(new Error('Povoleny jsou jen běžné adresy HTTP nebo HTTPS.'), { status: 400 })
    }
    await launchProcess('rundll32.exe', ['url.dll,FileProtocolHandler', url.href])
    return { ok: true, message: 'Webová stránka byla otevřena.', url: url.href }
  }
  if (name === 'open_application') {
    if (process.platform !== 'win32') throw Object.assign(new Error('Spouštění aplikací je dostupné jen ve Windows.'), { status: 501 })
    const app = PC_APPS[args.application]
    if (!app) throw Object.assign(new Error('Tuto aplikaci nelze tímto nástrojem spustit.'), { status: 400 })
    return await launchProcess(app.executable, app.args)
  }
  if (name === 'list_running_apps') {
    if (process.platform !== 'win32') throw Object.assign(new Error('Seznam aplikací je dostupný jen ve Windows.'), { status: 501 })
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | Sort-Object ProcessName | Select-Object -First 40 ProcessName,Id,CPU | ConvertTo-Json -Compress'], {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error((result.stderr || 'Seznam procesů se nepodařilo načíst.').trim().slice(0, 300))
    let processes = []
    try { processes = JSON.parse(result.stdout || '[]') } catch {}
    return { count: Array.isArray(processes) ? processes.length : 1, processes }
  }
  if (name === 'search_local_files') return searchFiles(args.folder, args.query)
  if (name === 'read_text_file') {
    if (process.platform !== 'win32') throw Object.assign(new Error('Čtení místních souborů je dostupné jen ve Windows.'), { status: 501 })
    const file = await safeFilePath(args.path)
    const info = await (await import('node:fs/promises')).stat(file)
    if (!info.isFile() || info.size > 100_000) throw Object.assign(new Error('Lze číst jen běžné textové soubory do 100 kB.'), { status: 400 })
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
    if (!['.txt', '.md', '.csv', '.log', '.json', '.xml'].includes(ext)) {
      throw Object.assign(new Error('Podporované typy jsou TXT, MD, CSV, LOG, JSON a XML.'), { status: 400 })
    }
    return { path: file, text: await (await import('node:fs/promises')).readFile(file, 'utf8') }
  }
  throw Object.assign(new Error('Tento lokální nástroj není povolen.'), { status: 400 })
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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

  if (req.method === 'POST' && req.url === '/api/pc/tool') {
    try {
      const body = await readJson(req, 32_000)
      if (typeof body.name !== 'string' || !body.name) return sendJson(res, 400, { error: 'Chybí název lokálního nástroje.' })
      const result = await runPcTool(body.name, body.args && typeof body.args === 'object' ? body.args : {})
      return sendJson(res, 200, { result })
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : 'Lokální nástroj selhal.' })
    }
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
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse', {
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
