import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const previous = process.env.BUILDPILOT_DATA_DIR
const directory = await mkdtemp(join(tmpdir(), 'buildpilot-test-'))
process.env.BUILDPILOT_DATA_DIR = directory
const store = await import('../src/store.mjs')

test('persists jobs, claims them once, and recovers interrupted work', async () => {
  try {
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
  } finally {
    if (previous === undefined) delete process.env.BUILDPILOT_DATA_DIR
    else process.env.BUILDPILOT_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})
