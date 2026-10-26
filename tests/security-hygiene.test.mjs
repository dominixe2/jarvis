import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8')
const rules = new Set(gitignore.split(/\r?\n/).map((line) => line.trim()))

test('local environment files are ignored while the example remains trackable', () => {
  assert.ok(rules.has('.env'), '.env must not be committed')
  assert.ok(rules.has('.env.*'), 'local environment variants must not be committed')
  assert.ok(rules.has('!.env.example'), 'the safe example environment file must remain trackable')
})
