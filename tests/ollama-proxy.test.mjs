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

function send(port, { token, origin = 'http://localhost:5173', host = 'localhost:5173', body = { messages: [{ role: 'user', content: 'Ahoj' }] } } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const headers = {
    host,
    origin,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  }
  if (token) headers.authorization = 'Bearer ' + token

  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/api/chat', method: 'POST', headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

async function startProxy(upstreamPort) {
  const probe = createServer()
  const port = await listen(probe)
  await close(probe)

  const child = spawn(process.execPath, [proxyPath], {
    env: {
      ...process.env,
      JARVIS_OLLAMA_PORT: String(port),
      OLLAMA_URL: 'http://127.0.0.1:' + upstreamPort + '/api/chat',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let settled = false
  let timer
  const token = await new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    timer = setTimeout(() => fail(new Error('Ollama proxy did not print its pairing token. Output: ' + output)), 5_000)
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      const match = output.match(/one-launch pairing token: ([A-Za-z0-9_-]{43})/)
      if (match && !settled) {
        settled = true
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    child.once('error', fail)
    child.once('exit', (code) => fail(new Error('Ollama proxy exited before startup (' + code + '): ' + output)))
  })

  return {
    port,
    token,
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))])
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

test('Ollama relay requires pairing, validates requests and forwards only authorized chat', async (t) => {
  let upstreamCalls = 0
  const upstream = createServer(async (req, res) => {
    upstreamCalls += 1
    for await (const _chunk of req) { /* consume request body */ }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    res.end('{"message":{"content":"test response"},"done":true}\n')
  })
  const upstreamPort = await listen(upstream)
  const proxy = await startProxy(upstreamPort)
  t.after(async () => {
    await proxy.stop()
    await close(upstream)
  })

  const unauthenticated = await send(proxy.port)
  assert.equal(unauthenticated.status, 401)
  assert.equal(upstreamCalls, 0)

  const wrongOrigin = await send(proxy.port, { token: proxy.token, origin: 'http://attacker.example:5173', host: 'localhost:5173' })
  assert.equal(wrongOrigin.status, 403)
  assert.equal(upstreamCalls, 0)

  const malformed = await send(proxy.port, { token: proxy.token, body: 'null' })
  assert.equal(malformed.status, 400)
  assert.equal(upstreamCalls, 0)

  const authorized = await send(proxy.port, { token: proxy.token })
  assert.equal(authorized.status, 200)
  assert.match(authorized.body, /test response/)
  assert.equal(upstreamCalls, 1)
})
