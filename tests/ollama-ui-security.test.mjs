import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ollamaClient = readFileSync(new URL('../src/lib/ollama.ts', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/ui/Settings.tsx', import.meta.url), 'utf8')
const proxy = readFileSync(new URL('../scripts/ollama-proxy.mjs', import.meta.url), 'utf8')
const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

test('JARVIS browser pairing never stores or sends a bearer secret through JavaScript', () => {
  assert.doesNotMatch(ollamaClient, /sessionStorage\.(?:getItem|setItem)|localStorage\.(?:getItem|setItem)|Authorization\s*:/i)
  assert.match(ollamaClient, /sessionStorage\.removeItem\('jarvis_ollama_pairing_token'\)/)
  assert.doesNotMatch(settings, /sessionStorage|localStorage|pairingTokenValue|PÁROVACÍ TOKEN Z TERMINÁLU/i)
  assert.match(settings, /HttpOnly cookie/)
  assert.doesNotMatch(proxy, /console\.log\([^)]*(?:pairingCode|sessionToken|PAIRING_CODE|Bearer)/i)
})

test('Ollama relay and local pairing status page bind only to loopback', () => {
  assert.ok(proxy.includes("server.listen(PORT, '127.0.0.1'"))
  assert.ok(proxy.includes("statusServer.listen(STATUS_PORT, '127.0.0.1'"))
})

test('Vite keeps pairing, status, unpair and chat paths on the same-origin relay', () => {
  assert.ok(vite.includes("rewrite: (path) => path.replace(/^\\/api\\/ollama/, '/api'),"))
})
