import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { approveJob, createJob, getJob, listJobs } from './store.mjs'

const HOST = '127.0.0.1'
const PORT = Number(process.env.BUILDPILOT_PORT || 8790)
const TOKEN = process.env.BUILDPILOT_TOKEN || ''
const WORKSPACE_ROOT = resolve(process.env.BUILDPILOT_WORKSPACES_DIR || 'workspaces')
const MAX_BODY_BYTES = 64 * 1024

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('BUILDPILOT_PORT must be a valid TCP port.')
}
if (TOKEN.length < 32) {
  throw new Error('Set BUILDPILOT_TOKEN to a random secret of at least 32 characters.')
}

await mkdir(WORKSPACE_ROOT, { recursive: true })
const realRoot = await realpath(WORKSPACE_ROOT)
const expectedPort = new URL('http://' + HOST + ':' + PORT).port

function send(response, status, body) {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'pragma': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(JSON.stringify(body))
}

function allowedLoopbackHost(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    const url = new URL('http://' + value)
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      url.port === expectedPort &&
      !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash
    )
  } catch {
    return false
  }
}

function allowedOrigin(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      url.port === expectedPort &&
      !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash
    )
  } catch {
    return false
  }
}

function authorised(request) {
  const supplied = request.headers.authorization
  if (typeof supplied !== 'string' || !supplied.startsWith('Bearer ')) return false
  const candidate = Buffer.from(supplied.slice(7), 'utf8')
  const expected = Buffer.from(TOKEN, 'utf8')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

function isJsonRequest(request) {
  const contentType = request.headers['content-type']
  return typeof contentType === 'string' &&
    contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json'
}

async function readBody(request) {
  const declared = request.headers['content-length']
  if (declared !== undefined) {
    if (!/^\d+$/.test(String(declared))) throw Object.assign(new Error(), { code: 'INVALID_LENGTH' })
    if (Number(declared) > MAX_BODY_BYTES) {
      request.resume()
      throw Object.assign(new Error(), { code: 'BODY_TOO_LARGE' })
    }
  }

  const chunks = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.length
    if (total > MAX_BODY_BYTES) {
      request.resume()
      throw Object.assign(new Error(), { code: 'BODY_TOO_LARGE' })
    }
    chunks.push(bytes)
  }

  let parsed
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))
    parsed = JSON.parse(raw || '{}')
  } catch {
    throw Object.assign(new Error(), { code: 'INVALID_JSON' })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error(), { code: 'INVALID_JSON' })
  }
  return parsed
}

async function resolveWorkspace(value) {
  if (typeof value !== 'string' || !value.trim() || isAbsolute(value)) {
    throw Object.assign(new Error(), { code: 'INVALID_WORKSPACE' })
  }
  try {
    const candidate = resolve(realRoot, value)
    const rel = relative(realRoot, candidate)
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
      throw new Error()
    }
    const canonical = await realpath(candidate)
    const canonicalRel = relative(realRoot, canonical)
    if (!canonicalRel || canonicalRel === '..' || canonicalRel.startsWith('..' + sep) || isAbsolute(canonicalRel)) {
      throw new Error()
    }
    if (!(await stat(canonical)).isDirectory()) throw new Error()
    return canonical
  } catch {
    throw Object.assign(new Error(), { code: 'INVALID_WORKSPACE' })
  }
}

function publicJob(job) {
  return {
    id: job.id,
    task: job.task,
    acceptanceCriteria: job.acceptanceCriteria,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    result: job.result || null,
    reviewedAt: job.reviewedAt || null,
    events: job.events,
  }
}

function errorResponse(error) {
  if (error?.code === 'BODY_TOO_LARGE') return [413, { error: 'Request body is too large.' }]
  if (error?.code === 'INVALID_LENGTH' || error?.code === 'INVALID_JSON') return [400, { error: 'Invalid JSON request.' }]
  if (error?.code === 'INVALID_WORKSPACE') return [400, { error: 'Workspace must be an existing child directory of the configured workspace root.' }]
  return [500, { error: 'Internal server error.' }]
}

async function handleRequest(request, response) {
  if (!allowedLoopbackHost(request.headers.host)) {
    return send(response, 403, { error: 'Host not allowed.' })
  }
  if (String(request.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    return send(response, 403, { error: 'Cross-site request blocked.' })
  }
  if (request.headers.origin !== undefined && !allowedOrigin(request.headers.origin)) {
    return send(response, 403, { error: 'Origin not allowed.' })
  }
  if (!authorised(request)) return send(response, 401, { error: 'Unauthorized.' })

  let url
  try {
    url = new URL(request.url || '/', 'http://' + HOST + ':' + PORT)
  } catch {
    return send(response, 400, { error: 'Invalid request URL.' })
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return send(response, 200, { ok: true, service: 'BuildPilot API' })
  }

  if (request.method === 'GET' && url.pathname === '/jobs') {
    const jobs = await listJobs()
    return send(response, 200, { jobs: jobs.map(publicJob) })
  }

  if (request.method === 'POST' && url.pathname === '/jobs') {
    if (!isJsonRequest(request)) return send(response, 415, { error: 'Content-Type must be application/json.' })
    const body = await readBody(request)
    if (typeof body.task !== 'string' || body.task.trim().length < 8 || body.task.length > 12000) {
      return send(response, 400, { error: 'Task must contain 8 to 12000 characters.' })
    }
    const workspace = await resolveWorkspace(body.workspace)
    const acceptanceCriteria = Array.isArray(body.acceptanceCriteria)
      ? body.acceptanceCriteria
          .filter((item) => typeof item === 'string' && item.trim())
          .slice(0, 30)
          .map((item) => item.trim().slice(0, 500))
      : []
    const job = await createJob({
      task: body.task.trim(),
      workspace,
      acceptanceCriteria,
    })
    return send(response, 202, { job: publicJob(job) })
  }

  const approveMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/approve$/i)
  if (request.method === 'POST' && approveMatch) {
    if (!isJsonRequest(request)) return send(response, 415, { error: 'Content-Type must be application/json.' })
    const body = await readBody(request)
    if (body.approved !== true || Object.keys(body).some((key) => key !== 'approved')) {
      return send(response, 400, { error: 'Explicit approval is required.' })
    }
    const result = await approveJob(approveMatch[1])
    if (result.outcome === 'not_found') return send(response, 404, { error: 'Job not found.' })
    if (result.outcome === 'conflict') return send(response, 409, { error: 'Job is not awaiting human review.' })
    return send(response, 200, { job: publicJob(result.job) })
  }

  const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})$/i)
  if (request.method === 'GET' && match) {
    const job = await getJob(match[1])
    return job ? send(response, 200, { job: publicJob(job) }) : send(response, 404, { error: 'Job not found.' })
  }

  return send(response, 404, { error: 'Not found.' })
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    const [status, body] = errorResponse(error)
    send(response, status, body)
  })
})

server.listen(PORT, HOST, () => {
  console.log('[BuildPilot] API listening on http://' + HOST + ':' + PORT)
})
