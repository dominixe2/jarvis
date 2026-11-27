import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const previousDataDir = process.env.BUILDPILOT_DATA_DIR
const directory = await mkdtemp(join(tmpdir(), 'buildpilot-store-'))
process.env.BUILDPILOT_DATA_DIR = directory
const store = await import('../src/store.mjs')

after(async () => {
  if (previousDataDir === undefined) delete process.env.BUILDPILOT_DATA_DIR
  else process.env.BUILDPILOT_DATA_DIR = previousDataDir
  await rm(directory, { recursive: true, force: true })
})

test('persists jobs, claims them once, and recovers an interrupted session', async () => {
  const created = await store.createJob({
    task: 'Create a small settings page',
    workspace: '/tmp/example',
    acceptanceCriteria: ['The page renders'],
  })
  assert.equal(created.status, 'queued')

  const claimed = await store.claimNextJob()
  assert.equal(claimed.id, created.id)
  assert.equal(claimed.status, 'running')
  assert.equal(await store.claimNextJob(), null)

  await store.updateJob(created.id, { sessionId: 'session-checkpoint' })
  assert.equal(await store.recoverInterruptedJobs(), 1)

  const recovered = await store.getJob(created.id)
  assert.equal(recovered.status, 'queued')
  assert.equal(recovered.sessionId, 'session-checkpoint')
})

test('requires a human approval transition after the worker requests review', async () => {
  const job = await store.createJob({ task: 'Implement a reviewable feature', workspace: '/tmp/example' })
  await store.updateJob(job.id, { status: 'needs_review' })
  const approved = await store.approveJob(job.id)
  assert.equal(approved.outcome, 'approved')
  assert.equal(approved.job.status, 'completed')
  assert.equal(approved.job.events.at(-1).type, 'human_approved')
  assert.equal((await store.approveJob(job.id)).outcome, 'conflict')
})

test('enforces one active worker lease', async () => {
  const release = await store.acquireWorkerLease()
  try {
    await assert.rejects(store.acquireWorkerLease(), /WORKER_ALREADY_RUNNING/)
  } finally {
    await release()
  }
  const releaseAgain = await store.acquireWorkerLease()
  await releaseAgain()
})

test('serializes writes across independent Node processes without losing jobs', async () => {
  const moduleUrl = new URL('../src/store.mjs', import.meta.url).href
  const script = [
    'import { createJob } from ' + JSON.stringify(moduleUrl) + ';',
    'const count = Number(process.env.BUILDPILOT_TEST_COUNT);',
    'await Promise.all(Array.from({ length: count }, (_, index) => createJob({',
    "  task: 'Concurrent job ' + index + ' from process ' + process.pid,",
    "  workspace: '/tmp/example',",
    '})));',
  ].join('\n')

  const children = Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, BUILDPILOT_DATA_DIR: directory, BUILDPILOT_TEST_COUNT: '5' },
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('child_exit_' + code)))
  }))
  await Promise.all(children)
  const jobs = await store.listJobs()
  assert.equal(jobs.filter((job) => job.task.startsWith('Concurrent job ')).length, 20)
})

test('fails closed on a corrupt store instead of silently replacing existing bytes', async () => {
  const corruptDir = await mkdtemp(join(tmpdir(), 'buildpilot-corrupt-'))
  const previous = process.env.BUILDPILOT_DATA_DIR
  const corruptFile = join(corruptDir, 'jobs.json')
  const original = '{"unexpected":"object"}'
  try {
    await writeFile(corruptFile, original, 'utf8')
    process.env.BUILDPILOT_DATA_DIR = corruptDir
    await assert.rejects(
      store.createJob({ task: 'Do not overwrite corrupt data', workspace: '/tmp/example' }),
      /STORE_SCHEMA_INVALID/,
    )
    assert.equal(await readFile(corruptFile, 'utf8'), original)
  } finally {
    if (previous === undefined) delete process.env.BUILDPILOT_DATA_DIR
    else process.env.BUILDPILOT_DATA_DIR = previous
    await rm(corruptDir, { recursive: true, force: true })
  }
})

test('caps configured automatic retries', async () => {
  const previous = process.env.BUILDPILOT_MAX_ATTEMPTS
  process.env.BUILDPILOT_MAX_ATTEMPTS = '999'
  try {
    const job = await store.createJob({ task: 'Check bounded retries', workspace: '/tmp/example' })
    assert.equal(job.maxAttempts, 20)
  } finally {
    if (previous === undefined) delete process.env.BUILDPILOT_MAX_ATTEMPTS
    else process.env.BUILDPILOT_MAX_ATTEMPTS = previous
  }
})
