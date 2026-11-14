import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const proxyPath = fileURLToPath(new URL('../scripts/ollama-proxy.mjs', import.meta.url))

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function close(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function requestJson(port, path, {
  origin = 'http://localhost:5173',
  host = 'localhost:5173',
  cookie,
  authorization,
  body = {},
} = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const headers = {
    host,
    origin,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  }
  if (cookie) headers.cookie = cookie
  if (authorization) headers.authorization = authorization
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
      }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

async function startProxy(upstreamPort) {
  const proxyProbe = createServer()
  const port = await listen(proxyProbe)
  await close(proxyProbe)
  const statusProbe = createServer()
  const statusPort = await listen(statusProbe)
  await close(statusProbe)

  const child = spawn(process.execPath, [proxyPath], {
    env: {
      ...process.env,
      JARVIS_OLLAMA_PORT: String(port),
      JARVIS_OLLAMA_STATUS_PORT: String(statusPort),
      OLLAMA_URL: 'http://127.0.0.1:' + upstreamPort + '/api/chat',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let settled = false
  let timer
  const statusUrl = 'http://127.0.0.1:' + statusPort
  try {
    await new Promise((resolve, reject) => {
      const fail = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
      timer = setTimeout(() => fail(new Error('Ollama proxy did not start its local pairing page.')), 5_000)
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
        if (output.includes('local pairing page: ' + statusUrl) && !settled) {
          settled = true
          clearTimeout(timer)
          resolve()
        }
      })
      child.stderr.on('data', (chunk) => { output += chunk.toString() })
      child.once('error', fail)
      child.once('exit', (code) => fail(new Error('Ollama proxy exited before startup (' + code + ').')))
    })
    let status
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await fetch(statusUrl + '/status', { cache: 'no-store' })
        if (response.ok) { status = await response.json(); break }
      } catch { /* wait for the local status listener */ }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!status?.pairing_code) throw new Error('Local pairing status did not provide a live code.')
  } catch (error) {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 1_000))])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    throw error
  }

  return {
    port,
    statusUrl,
    code: status.pairing_code,
    output,
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))])
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

function cookieValue(response) {
  const header = response.headers['set-cookie']
  assert.ok(Array.isArray(header) && header.length > 0)
  return header[0].split(';', 1)[0]
}

test('Ollama relay pairs once, keeps the session HttpOnly and forwards only authorized chat', async (t) => {
  let upstreamCalls = 0
  const upstream = createServer(async (req, res) => {
    upstreamCalls += 1
    for await (const chunk of req) { void chunk }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    res.end('{"message":{"content":"test response"},"done":true}\n')
  })
  const upstreamPort = await listen(upstream)
  let proxy
  t.after(async () => {
    if (proxy) await proxy.stop()
    await close(upstream)
  })
  proxy = await startProxy(upstreamPort)

  const unauthenticated = await requestJson(proxy.port, '/api/chat')
  assert.equal(unauthenticated.status, 401)
  assert.equal(upstreamCalls, 0)

  const wrongOrigin = await requestJson(proxy.port, '/api/pair', {
    origin: 'http://attacker.example:5173',
    body: { code: proxy.code },
  })
  assert.equal(wrongOrigin.status, 403)

  const wrongCode = await requestJson(proxy.port, '/api/pair', {
    body: { code: proxy.code === '000000' ? '000001' : '000000' },
  })
  assert.equal(wrongCode.status, 401)

  const paired = await requestJson(proxy.port, '/api/pair', { body: { code: proxy.code } })
  assert.equal(paired.status, 200)
  assert.deepEqual(JSON.parse(paired.body), { paired: true })
  const cookie = cookieValue(paired)
  const setCookie = paired.headers['set-cookie'][0]
  assert.match(setCookie, /HttpOnly/i)
  assert.match(setCookie, /SameSite=Strict/i)
  assert.match(setCookie, /Max-Age=43200/i)
  assert.doesNotMatch(paired.body, /jarvis_ollama_session/)
  assert.doesNotMatch(proxy.output, new RegExp(proxy.code))
  assert.doesNotMatch(proxy.output, /pairing token|Bearer /i)

  const reusedCode = await requestJson(proxy.port, '/api/pair', { body: { code: proxy.code } })
  assert.equal(reusedCode.status, 409)

  const wrongOriginChat = await requestJson(proxy.port, '/api/chat', {
    origin: 'http://attacker.example:5173',
    cookie,
  })
  assert.equal(wrongOriginChat.status, 403)

  const malformed = await requestJson(proxy.port, '/api/chat', { cookie, body: 'null' })
  assert.equal(malformed.status, 400)
  assert.equal(upstreamCalls, 0)

  const authorized = await requestJson(proxy.port, '/api/chat', { cookie })
  assert.equal(authorized.status, 200)
  assert.match(authorized.body, /test response/)
  assert.equal(upstreamCalls, 1)

  const unpaired = await requestJson(proxy.port, '/api/unpair', { cookie })
  assert.equal(unpaired.status, 200)
  assert.match(unpaired.headers['set-cookie'][0], /Max-Age=0/i)
  const afterUnpair = await requestJson(proxy.port, '/api/chat', { cookie })
  assert.equal(afterUnpair.status, 401)

  const refreshedStatus = await fetch(proxy.statusUrl + '/status', { cache: 'no-store' }).then((response) => response.json())
  assert.match(refreshedStatus.pairing_code, /^\d{6}$/)
  assert.notEqual(refreshedStatus.pairing_code, proxy.code)
})

test('pairing code is available only from the loopback no-store status page', async (t) => {
  const upstream = createServer((_req, res) => res.end())
  const upstreamPort = await listen(upstream)
  let proxy
  t.after(async () => {
    if (proxy) await proxy.stop()
    await close(upstream)
  })
  proxy = await startProxy(upstreamPort)

  const page = await fetch(proxy.statusUrl, { cache: 'no-store' })
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(page.headers.get('cache-control'), /no-store/i)
  assert.match(html, /textContent/)
  assert.doesNotMatch(html, /localStorage|sessionStorage/)

  const response = await fetch(proxy.statusUrl + '/status', { cache: 'no-store' })
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.pairing_code, proxy.code)
  assert.match(response.headers.get('cache-control'), /no-store/i)
})

test('Ollama upstream error details are not reflected to the paired client', async (t) => {
  const privateDetail = 'PRIVATE_PROMPT_FRAGMENT token=upstream-secret'
  const upstream = createServer(async (req, res) => {
    for await (const chunk of req) { void chunk }
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end(privateDetail)
  })
  const upstreamPort = await listen(upstream)
  let proxy
  t.after(async () => {
    if (proxy) await proxy.stop()
    await close(upstream)
  })
  proxy = await startProxy(upstreamPort)
  const paired = await requestJson(proxy.port, '/api/pair', { body: { code: proxy.code } })
  assert.equal(paired.status, 200)
  const response = await requestJson(proxy.port, '/api/chat', { cookie: cookieValue(paired) })
  assert.equal(response.status, 502)
  assert.match(response.body, /Ollama vrátila HTTP 502/)
  assert.doesNotMatch(response.body, /PRIVATE_PROMPT_FRAGMENT|upstream-secret/)
})


test('phone pairing rejects plain HTTP on a LAN and marks HTTPS sessions Secure', async (t) => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    res.end('{"message":{"content":"secure test"},"done":true}\\n')
  })
  const upstreamPort = await listen(upstream)
  let proxy
  t.after(async () => {
    if (proxy) await proxy.stop()
    await close(upstream)
  })
  proxy = await startProxy(upstreamPort)

  const insecure = await requestJson(proxy.port, '/api/pair', {
    origin: 'http://192.168.1.44:5173',
    host: '192.168.1.44:5173',
    body: { code: proxy.code },
  })
  assert.equal(insecure.status, 403)

  const secure = await requestJson(proxy.port, '/api/pair', {
    origin: 'https://192.168.1.44:5173',
    host: '192.168.1.44:5173',
    body: { code: proxy.code },
  })
  assert.equal(secure.status, 200)
  assert.match(secure.headers['set-cookie'][0], /Secure/i)
  assert.match(secure.headers['set-cookie'][0], /HttpOnly/i)
})
