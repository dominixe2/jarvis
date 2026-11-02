import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('local environment files are ignored while the example remains trackable', () => {
  const result = spawnSync(
    'git',
    ['check-ignore', '--no-index', '--stdin'],
    {
      input: ['.env', '.env.local', '.env.production', '.env.example'].join('\n'),
      encoding: 'utf8',
    },
  )

  assert.equal(result.error, undefined, 'git must be available in the test environment')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    result.stdout.trim().split(/\r?\n/).sort(),
    ['.env', '.env.local', '.env.production'],
    'only local environment files should be ignored; .env.example must remain trackable',
  )
})
