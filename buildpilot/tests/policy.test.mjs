import test from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedCommand } from '../src/policy.mjs'

test('allows only known validation commands', () => {
  assert.equal(isAllowedCommand('npm test'), true)
  assert.equal(isAllowedCommand('npm run build'), true)
  assert.equal(isAllowedCommand('git diff --check'), true)
})

test('blocks arbitrary and chained shell commands', () => {
  assert.equal(isAllowedCommand('rm -rf .'), false)
  assert.equal(isAllowedCommand('npm test && rm -rf .'), false)
  assert.equal(isAllowedCommand('cat ~/.ssh/id_rsa'), false)
  assert.equal(isAllowedCommand('npm test > /tmp/out'), false)
  assert.equal(isAllowedCommand(''), false)
})
