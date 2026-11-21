import { createServer } from 'node:http'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { createJob, getJob, listJobs } from './store.mjs'

const HOST = '127.0.0.1'
const PORT = Number(process.env.BUILDPILOT_PORT || 8790)
const TOKEN = process.env.BUILDPILOT_TOKEN
const WORKSPACE_ROOT = resolve(process.env.BUILDPILOT_WORKSPACES_DIR || 'workspaces')
const MAX_BODY = 64 * 1024

if (!TOKEN || TOKEN.length < 24) {
  throw new Error('Set BUILDPILOT_TOKEN to a random secret of at least 24 characters.')
}
await mkdir(WORKSPACE_ROOT, { recursive: true })
const realRoot = await realpath(WORKSPACE_ROOT)

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

function authorised(request) {
  return request.headers.authorization === `Bearer ${TOKEN}`
}

async function readBody(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > MAX_BODY) throw new Error('Request body too large.')
  }
  return JSON.parse(body || '{}')
}

async function resolveWorkspace(value) {
  if (typeof value !== 'string' || !value.trim() || isAbsolute(value)) {
    throw new Error('workspace must be a relative directory inside the workspace root.')
  }
  const candidate = await realpath(resolve(realRoot, value))
  const rel = relative(realRoot, candidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Workspace must be a child directory of the configured workspace root.')
  }
  if (!(await stat(candidate)).isDirectory()) throw new Error('Workspace must be a directory.')
  return candidate
}

const server = createServer(async (request, response) => {
  if (!authorised(request)) return send(response, 401, { error: 'Unauthorized' })
  const url = new URL(request.url || '/', `http://${HOST}:${PORT}`)

  if (request.method === 'GET' && url.pathname === '/health') {
    return send(response, 200, { ok: true, service: 'BuildPilot API' })
  }
  if (request.method === 'GET' && url.pathname === '/jobs') {
    return send(response, 200, { jobs: await listJobs() })
  }
  if (request.method === 'POST' && url.pathname === '/jobs') {
    try {
      const body = await readBody(request)
      if (typeof body.task !== 'string' || body.task.trim().length < 8 || body.task.length > 12000) {
        return send(response, 400, { error: 'task must contain 8 to 12000 characters.' })
      }
      const workspace = await resolveWorkspace(body.workspace)
      const acceptanceCriteria = Array.isArray(body.acceptanceCriteria)
        ? body.acceptanceCriteria.filter((item) => typeof item === 'string' && item.trim()).slice(0, 30)
        : []
      const job = await createJob({
        task: body.task.trim(),
        workspace,
        acceptanceCriteria,
      })
      return send(response, 202, { job })
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})$/i)
  if (request.method === 'GET' && match) {
    const job = await getJob(match[1])
    return job ? send(response, 200, { job }) : send(response, 404, { error: 'Job not found.' })
  }
  return send(response, 404, { error: 'Not found.' })
})

server.listen(PORT, HOST, () => {
  console.log(`[BuildPilot] API listening on http://${HOST}:${PORT}`)
})
