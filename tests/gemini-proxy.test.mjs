import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

const proxyPath = resolve(fileURLToPath(new URL('../scripts/gemini-proxy.mjs', import.meta.url)))
const origin = 'http://localhost:5173'
let root
let port
let child

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a test port.')
  const chosen = address.port
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return chosen
}

async function request(path, init = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { Origin: origin, ...(init.headers || {}) },
  })
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'jarvis-proxy-test-'))
  port = await freePort()
  child = spawn(process.execPath, [proxyPath], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: join(root, 'appdata'),
      JARVIS_GEMINI_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })

  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Gemini proxy exited before startup: ${output}`)
    try {
      const response = await request('/api/gemini/status')
      if (response.ok) { ready = true; break }
    } catch {
      // The child has not started listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  if (!ready) {
    child.kill()
    throw new Error(`Gemini proxy did not start in time: ${output}`)
  }
})

after(async () => {
  if (child && child.exitCode === null) {
    child.kill()
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 3000)),
    ])
  }
  if (root) await rm(root, { recursive: true, force: true })
})

test('status reports backend and never returns the stored API key', async () => {
  const response = await request('/api/gemini/status')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') || '', /no-store/)
  const body = await response.json()
  assert.equal(body.configured, false)
  assert.equal(body.backend, 'bridge')
  assert.equal(typeof body.secureStorage, 'boolean')
  assert.equal('key' in body, false)
  assert.equal('apiKey' in body, false)
})

test('rejects requests from an untrusted origin', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/gemini/status`, {
    headers: { Origin: 'https://untrusted.example' },
  })
  assert.equal(response.status, 403)
})

test('backend selector validates choices and persists only the selected mode', async () => {
  const invalid = await request('/api/backend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend: 'unknown' }),
  })
  assert.equal(invalid.status, 400)

  const saved = await request('/api/backend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend: 'gemini' }),
  })
  assert.equal(saved.status, 200)
  assert.deepEqual(await saved.json(), { backend: 'gemini', restartRequired: true })
  assert.match(await readFile(join(root, '.env.local'), 'utf8'), /^VITE_BACKEND=gemini$/m)

  const status = await request('/api/gemini/status')
  assert.equal((await status.json()).backend, 'gemini')
})

test('rejects empty and malformed API keys before attempting storage', async () => {
  for (const key of ['', '  ', 'not-a-real-key\nwith-a-newline']) {
    const response = await request('/api/gemini/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    assert.equal(response.status, 400)
  }
})

test('credential storage is DPAPI-encrypted on Windows and explicitly unavailable elsewhere', async () => {
  const fakeKey = 'JARVIS_TEST_KEY_NOT_A_REAL_CREDENTIAL_12345'
  const response = await request('/api/gemini/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: fakeKey }),
  })

  if (process.platform !== 'win32') {
    assert.equal(response.status, 500)
    assert.match((await response.json()).error, /Windows/)
    return
  }

  assert.equal(response.status, 200)
  const encryptedPath = join(root, 'appdata', 'JARVIS', 'gemini-key.dpapi')
  const encrypted = await readFile(encryptedPath, 'utf8')
  assert.ok(encrypted.length > 0)
  assert.equal(encrypted.includes(fakeKey), false)

  const status = await request('/api/gemini/status')
  assert.equal((await status.json()).configured, true)

  const removed = await request('/api/gemini/key', { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal((await removed.json()).configured, false)
})
