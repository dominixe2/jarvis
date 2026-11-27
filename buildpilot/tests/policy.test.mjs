import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorizeTool, isAllowedCommand, isAllowedWorkspacePath } from '../src/policy.mjs'

const root = await mkdtemp(join(tmpdir(), 'buildpilot-policy-'))
const outside = await mkdtemp(join(tmpdir(), 'buildpilot-outside-'))
await mkdir(join(root, 'src'), { recursive: true })
await writeFile(join(root, 'src', 'index.js'), 'export const ok = true')
await writeFile(join(root, '.env'), 'DO_NOT_READ=secret')
await writeFile(join(root, '.env.example'), 'PLACEHOLDER=value')
await mkdir(join(root, '.git'), { recursive: true })
await writeFile(join(root, '.git', 'config'), '[remote]')
await writeFile(join(outside, 'outside.txt'), 'outside')
await symlink(outside, join(root, 'escape'), 'dir')

after(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

test('allows ordinary files inside the canonical workspace', async () => {
  assert.equal(await isAllowedWorkspacePath(root, 'src/index.js'), true)
  assert.equal(await isAllowedWorkspacePath(root, join(root, 'src', 'index.js')), true)
  assert.equal(await isAllowedWorkspacePath(root, root, { allowRoot: true }), true)
})

test('rejects traversal, outside paths, workspace root as a file, and symlink escapes', async () => {
  assert.equal(await isAllowedWorkspacePath(root, '../outside/outside.txt'), false)
  assert.equal(await isAllowedWorkspacePath(root, join(outside, 'outside.txt')), false)
  assert.equal(await isAllowedWorkspacePath(root, root), false)
  assert.equal(await isAllowedWorkspacePath(root, 'escape/outside.txt'), false)
})

test('blocks credential and repository metadata files but permits safe env examples', async () => {
  assert.equal(await isAllowedWorkspacePath(root, '.env'), false)
  assert.equal(await isAllowedWorkspacePath(root, '.git/config'), false)
  assert.equal(await isAllowedWorkspacePath(root, '.env.example'), true)
})

test('allows scoped file tools and disables recursive content Grep', async () => {
  assert.deepEqual(
    await authorizeTool('Read', { file_path: 'src/index.js' }, { workspace: root }),
    { behavior: 'allow' },
  )
  assert.equal((await authorizeTool('Read', { file_path: '.env' }, { workspace: root })).behavior, 'deny')
  assert.equal((await authorizeTool('Glob', { pattern: '../**/*' }, { workspace: root })).behavior, 'deny')
  assert.equal((await authorizeTool('Grep', { pattern: 'secret' }, { workspace: root })).behavior, 'deny')
})

test('shell validation commands are opt-in except for non-executing git checks', () => {
  const previous = process.env.BUILDPILOT_ALLOWED_COMMANDS
  delete process.env.BUILDPILOT_ALLOWED_COMMANDS
  try {
    assert.equal(isAllowedCommand('git status --short'), true)
    assert.equal(isAllowedCommand('git diff --check'), true)
    assert.equal(isAllowedCommand('npm test'), false)
    assert.equal(isAllowedCommand('npm test && rm -rf .'), false)
    assert.equal(isAllowedCommand('cat ~/.ssh/id_rsa'), false)
    process.env.BUILDPILOT_ALLOWED_COMMANDS = 'npm test'
    assert.equal(isAllowedCommand('npm test'), true)
  } finally {
    if (previous === undefined) delete process.env.BUILDPILOT_ALLOWED_COMMANDS
    else process.env.BUILDPILOT_ALLOWED_COMMANDS = previous
  }
})
