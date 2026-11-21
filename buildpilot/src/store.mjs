import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const dataFile = () => join(process.env.BUILDPILOT_DATA_DIR || 'buildpilot/data', 'jobs.json')
const VALID_STATUSES = new Set(['queued', 'running', 'needs_review', 'needs_attention', 'completed', 'failed', 'cancelled'])
let mutation = Promise.resolve()

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function ensureDataDirectory() {
  const directory = dirname(dataFile())
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('STORE_DIRECTORY_INVALID')
  return directory
}

async function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

async function removeDeadLock(lockPath) {
  let before
  try {
    before = await lstat(lockPath)
    if (before.isSymbolicLink() || !before.isFile()) throw new Error('STORE_LOCK_INVALID')
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    throw error
  }

  let metadata
  try {
    metadata = JSON.parse(await readFile(lockPath, 'utf8'))
  } catch {
    if (Date.now() - before.mtimeMs < 30000) return false
  }

  if (metadata && await processIsAlive(metadata.pid)) return false
  if (metadata && !Number.isSafeInteger(metadata.pid)) return false

  try {
    const current = await lstat(lockPath)
    if (current.ino !== before.ino || current.isSymbolicLink()) return false
    await unlink(lockPath)
    return true
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

async function acquireStoreLock() {
  await ensureDataDirectory()
  const lockPath = dataFile() + '.lock'
  const token = randomUUID()
  const started = Date.now()

  while (Date.now() - started < 10000) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }))
        await handle.sync()
      } catch (error) {
        await handle.close().catch(() => {})
        await unlink(lockPath).catch(() => {})
        throw error
      }

      return async () => {
        await handle.close().catch(() => {})
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8'))
          if (current.token === token) await unlink(lockPath)
        } catch {}
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await removeDeadLock(lockPath)
      await delay(25)
    }
  }
  throw new Error('STORE_BUSY')
}

async function withStoreLock(operation) {
  const release = await acquireStoreLock()
  try {
    return await operation()
  } finally {
    await release()
  }
}

function serialise(operation) {
  const next = mutation.then(
    () => withStoreLock(operation),
    () => withStoreLock(operation),
  )
  mutation = next.catch(() => {})
  return next
}

function validJob(job) {
  return Boolean(
    job &&
    typeof job === 'object' &&
    typeof job.id === 'string' &&
    typeof job.task === 'string' &&
    typeof job.workspace === 'string' &&
    VALID_STATUSES.has(job.status) &&
    Number.isSafeInteger(job.attempts) &&
    Number.isSafeInteger(job.maxAttempts) &&
    Array.isArray(job.events),
  )
}

async function readJobs() {
  const file = dataFile()
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('STORE_FILE_INVALID')
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new Error('STORE_CORRUPT')
  }
  if (!Array.isArray(parsed) || !parsed.every(validJob)) throw new Error('STORE_SCHEMA_INVALID')
  return parsed
}

async function writeJobs(jobs) {
  await ensureDataDirectory()
  const file = dataFile()
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp'
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(JSON.stringify(jobs, null, 2), 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, file)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function maxAttemptsFromEnvironment() {
  const value = Number(process.env.BUILDPILOT_MAX_ATTEMPTS || 12)
  if (!Number.isFinite(value)) return 12
  return Math.min(20, Math.max(1, Math.trunc(value)))
}

export async function createJob({ task, workspace, acceptanceCriteria = [] }) {
  return serialise(async () => {
    if (typeof task !== 'string' || typeof workspace !== 'string') throw new Error('JOB_INPUT_INVALID')
    const jobs = await readJobs()
    const now = new Date().toISOString()
    const criteria = Array.isArray(acceptanceCriteria)
      ? acceptanceCriteria.filter((item) => typeof item === 'string' && item.trim()).slice(0, 30)
      : []
    const job = {
      id: randomUUID(),
      task,
      workspace,
      acceptanceCriteria: criteria,
      status: 'queued',
      sessionId: null,
      attempts: 0,
      maxAttempts: maxAttemptsFromEnvironment(),
      createdAt: now,
      updatedAt: now,
      lastError: null,
      events: [{ at: now, type: 'created', message: 'Job added to the queue.' }],
    }
    jobs.push(job)
    await writeJobs(jobs)
    return job
  })
}

export async function getJob(id) {
  return (await readJobs()).find((job) => job.id === id) || null
}

export async function listJobs() {
  return (await readJobs()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function updateJob(id, patch, event) {
  return serialise(async () => {
    const jobs = await readJobs()
    const index = jobs.findIndex((job) => job.id === id)
    if (index < 0) return null
    const now = new Date().toISOString()
    const current = jobs[index]
    const updated = {
      ...current,
      ...patch,
      updatedAt: now,
      events: event ? [...current.events, { at: now, ...event }].slice(-100) : current.events,
    }
    if (!validJob(updated)) throw new Error('JOB_UPDATE_INVALID')
    jobs[index] = updated
    await writeJobs(jobs)
    return updated
  })
}

export async function approveJob(id) {
  return serialise(async () => {
    const jobs = await readJobs()
    const index = jobs.findIndex((job) => job.id === id)
    if (index < 0) return { outcome: 'not_found', job: null }
    if (jobs[index].status !== 'needs_review') return { outcome: 'conflict', job: jobs[index] }
    const now = new Date().toISOString()
    const updated = {
      ...jobs[index],
      status: 'completed',
      reviewedAt: now,
      updatedAt: now,
      events: [...jobs[index].events, {
        at: now,
        type: 'human_approved',
        message: 'A human explicitly approved the completed job.',
      }].slice(-100),
    }
    jobs[index] = updated
    await writeJobs(jobs)
    return { outcome: 'approved', job: updated }
  })
}

export async function claimNextJob() {
  return serialise(async () => {
    const jobs = await readJobs()
    const job = jobs.find((item) => item.status === 'queued')
    if (!job) return null
    const now = new Date().toISOString()
    job.status = 'running'
    job.attempts += 1
    job.updatedAt = now
    job.events = [...job.events, {
      at: now,
      type: 'started',
      message: 'Worker attempt ' + job.attempts + ' started.',
    }].slice(-100)
    await writeJobs(jobs)
    return job
  })
}

export async function recoverInterruptedJobs() {
  return serialise(async () => {
    const jobs = await readJobs()
    let recovered = 0
    for (const job of jobs) {
      if (job.status !== 'running') continue
      job.status = 'queued'
      job.updatedAt = new Date().toISOString()
      job.events = [...job.events, {
        at: job.updatedAt,
        type: 'recovered',
        message: 'Worker restarted; resuming from the saved agent session.',
      }].slice(-100)
      recovered += 1
    }
    if (recovered) await writeJobs(jobs)
    return recovered
  })
}

/** Enforce one active worker so startup recovery cannot requeue another worker's job. */
export async function acquireWorkerLease() {
  const directory = await ensureDataDirectory()
  const lockPath = join(directory, 'worker.lock')
  const token = randomUUID()

  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }))
      await handle.sync()
      return async () => {
        await handle.close().catch(() => {})
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8'))
          if (current.token === token) await unlink(lockPath)
        } catch {}
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const removed = await removeDeadLock(lockPath)
      if (removed) continue
      throw new Error('WORKER_ALREADY_RUNNING')
    }
  }
}
