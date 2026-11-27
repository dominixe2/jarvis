import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const token = 'buildpilot-test-token-' + 'x'.repeat(40)
const temporary = await mkdtemp(join(tmpdir(), 'buildpilot-server-'))
const workspaceRoot = join(temporary, 'workspaces')
const dataDirectory = join(temporary, 'data')
await mkdir(join(workspaceRoot, 'demo'), { recursive: true })

let child
let baseUrl
let store

async function freePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const port = listener.address().port
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return port
}

function request(path, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, baseUrl)
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname + url.search,
      method,
      headers,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
        json() { return JSON.parse(this.text) },
      }))
    })
    req.once('error', reject)
    req.end(body)
  })
}

const auth = { authorization: 'Bearer ' + token }
const jsonHeaders = { ...auth, 'content-type': 'application/json' }

before(async () => {
  const port = await freePort()
  baseUrl = 'http://127.0.0.1:' + port
  const serverPath = fileURLToPath(new URL('../src/server.mjs', import.meta.url))
  child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      BUILDPILOT_TOKEN: token,
      BUILDPILOT_PORT: String(port),
      BUILDPILOT_WORKSPACES_DIR: workspaceRoot,
      BUILDPILOT_DATA_DIR: dataDirectory,
    },
    stdio: 'ignore',
  })

  let ready = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await request('/health', { headers: auth })
      if (response.status === 200) {
        ready = true
        break
      }
    } catch {}
    if (child.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.equal(ready, true, 'BuildPilot API did not become ready')
  process.env.BUILDPILOT_DATA_DIR = dataDirectory
  store = await import('../src/store.mjs')
})

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 1000))])
  }
  await rm(temporary, { recursive: true, force: true })
})

test('requires the bearer token and rejects DNS-rebinding Host values', async () => {
  assert.equal((await request('/health')).status, 401)
  const spoofed = await request('/health', { headers: { ...auth, host: 'attacker.example' } })
  assert.equal(spoofed.status, 403)
})

test('rejects cross-origin writes and cross-site fetches', async () => {
  const origin = await request('/jobs', {
    method: 'POST',
    headers: { ...jsonHeaders, origin: 'http://attacker.example' },
    body: JSON.stringify({ task: 'Create a settings page', workspace: 'demo' }),
  })
  assert.equal(origin.status, 403)

  const fetchSite = await request('/health', {
    headers: { ...auth, 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(fetchSite.status, 403)
})

test('enforces request limits in bytes, including multibyte UTF-8 input', async () => {
  const body = JSON.stringify({ task: 'é'.repeat(40000), workspace: 'demo' })
  assert.ok(Buffer.byteLength(body, 'utf8') > 64 * 1024)
  assert.ok(body.length < 64 * 1024)
  const response = await request('/jobs', { method: 'POST', headers: jsonHeaders, body })
  assert.equal(response.status, 413)
})

test('rejects invalid content types and malformed JSON without exposing internals', async () => {
  const wrongType = await request('/jobs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ task: 'Create a settings page', workspace: 'demo' }),
  })
  assert.equal(wrongType.status, 415)

  const malformed = await request('/jobs', {
    method: 'POST',
    headers: jsonHeaders,
    body: '{',
  })
  assert.equal(malformed.status, 400)
  assert.equal(malformed.text.includes(temporary), false)
})

test('rejects workspace traversal and does not disclose filesystem paths', async () => {
  const response = await request('/jobs', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ task: 'Create a settings page', workspace: '../outside' }),
  })
  assert.equal(response.status, 400)
  assert.equal(response.text.includes(temporary), false)
})

test('creates a redacted job view and requires explicit human approval', async () => {
  const created = await request('/jobs', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      task: 'Create a settings page',
      workspace: 'demo',
      acceptanceCriteria: ['The page renders'],
    }),
  })
  assert.equal(created.status, 202)
  const job = created.json().job
  assert.equal(job.status, 'queued')
  assert.equal('workspace' in job, false)
  assert.equal('sessionId' in job, false)
  assert.equal('lastError' in job, false)

  await store.updateJob(job.id, { status: 'needs_review', sessionId: 'private-session-id' })
  const approved = await request('/jobs/' + job.id + '/approve', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ approved: true }),
  })
  assert.equal(approved.status, 200)
  assert.equal(approved.json().job.status, 'completed')
  assert.equal('sessionId' in approved.json().job, false)

  const duplicate = await request('/jobs/' + job.id + '/approve', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ approved: true }),
  })
  assert.equal(duplicate.status, 409)
})
