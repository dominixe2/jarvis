import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const dataFile = () => join(process.env.BUILDPILOT_DATA_DIR || 'buildpilot/data', 'jobs.json')
let mutation = Promise.resolve()

async function readJobs() {
  try {
    const parsed = JSON.parse(await readFile(dataFile(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function writeJobs(jobs) {
  const file = dataFile()
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(jobs, null, 2), { mode: 0o600 })
  await rename(temporary, file)
}

function serialise(operation) {
  const next = mutation.then(operation, operation)
  mutation = next.catch(() => {})
  return next
}

export async function createJob({ task, workspace, acceptanceCriteria = [] }) {
  return serialise(async () => {
    const jobs = await readJobs()
    const now = new Date().toISOString()
    const job = {
      id: randomUUID(),
      task,
      workspace,
      acceptanceCriteria,
      status: 'queued',
      sessionId: null,
      attempts: 0,
      maxAttempts: Number(process.env.BUILDPILOT_MAX_ATTEMPTS || 12),
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
      events: event
        ? [...current.events, { at: now, ...event }].slice(-100)
        : current.events,
    }
    jobs[index] = updated
    await writeJobs(jobs)
    return updated
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
    job.events = [...job.events, { at: now, type: 'started', message: `Worker attempt ${job.attempts} started.` }].slice(-100)
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
