import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createConcurrencyGate,
  createPairingToken,
  createSlidingWindowLimiter,
  hasValidBearerToken,
  isAllowedOrigin,
  isValidChatPayload,
} from '../scripts/ollama-security.mjs'

test('pairing token has 256 bits of per-launch entropy in URL-safe form', () => {
  const first = createPairingToken()
  const second = createPairingToken()
  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first, second)
})

test('bearer validation accepts only the exact token', () => {
  const token = createPairingToken()
  assert.equal(hasValidBearerToken('Bearer ' + token, token), true)
  assert.equal(hasValidBearerToken('bearer ' + token, token), false)
  assert.equal(hasValidBearerToken('Bearer ' + token + 'x', token), false)
  assert.equal(hasValidBearerToken('Bearer wrong', token), false)
  assert.equal(hasValidBearerToken(undefined, token), false)
})

test('origin validation accepts matching local dev and HTTPS origins', () => {
  assert.equal(isAllowedOrigin('http://192.168.1.10:5173', '192.168.1.10:5173'), true)
  assert.equal(isAllowedOrigin('https://jarvis.local:4173', 'jarvis.local:4173'), true)
})

test('origin validation rejects host, port, scheme, path and port-range mismatches', () => {
  assert.equal(isAllowedOrigin('https://jarvis.local:5173', 'other.local:5173'), false)
  assert.equal(isAllowedOrigin('https://jarvis.local:5173', 'jarvis.local:8789'), false)
  assert.equal(isAllowedOrigin('ftp://jarvis.local:5173', 'jarvis.local:5173'), false)
  assert.equal(isAllowedOrigin('https://jarvis.local:5173/attacker', 'jarvis.local:5173'), false)
  assert.equal(isAllowedOrigin('https://jarvis.local:8789', 'jarvis.local:8789'), false)
  assert.equal(isAllowedOrigin('', 'jarvis.local:5173'), false)
})

test('sliding-window limiter rejects excess requests and expires old entries', () => {
  let clock = 1_000
  const allow = createSlidingWindowLimiter({ limit: 2, windowMs: 1_000, maxKeys: 2, now: () => clock })
  assert.equal(allow('127.0.0.1'), true)
  assert.equal(allow('127.0.0.1'), true)
  assert.equal(allow('127.0.0.1'), false)
  clock = 2_001
  assert.equal(allow('127.0.0.1'), true)
})

test('sliding-window limiter bounds the number of tracked client keys', () => {
  const allow = createSlidingWindowLimiter({ limit: 1, windowMs: 10_000, maxKeys: 2 })
  assert.equal(allow('one'), true)
  assert.equal(allow('two'), true)
  assert.equal(allow('three'), true)
  assert.equal(allow('three'), false)
})

test('concurrency gate caps active upstream work and releases idempotently', () => {
  const gate = createConcurrencyGate(2)
  const releaseA = gate.tryAcquire()
  const releaseB = gate.tryAcquire()
  assert.equal(gate.active, 2)
  assert.equal(gate.tryAcquire(), null)
  releaseA()
  releaseA()
  assert.equal(gate.active, 1)
  const releaseC = gate.tryAcquire()
  assert.equal(typeof releaseC, 'function')
  releaseB()
  releaseC()
  assert.equal(gate.active, 0)
})

test('chat payload validation rejects null, primitives, arrays and malformed messages', () => {
  assert.equal(isValidChatPayload(null), false)
  assert.equal(isValidChatPayload('not an object'), false)
  assert.equal(isValidChatPayload([]), false)
  assert.equal(isValidChatPayload({ messages: 'hello' }), false)
  assert.equal(isValidChatPayload({ messages: [{ role: 'system', content: 1 }] }), false)
  assert.equal(isValidChatPayload({ messages: [{ role: 'tool', content: 'x' }] }), false)
  assert.equal(isValidChatPayload({ messages: Array.from({ length: 101 }, () => ({ role: 'user', content: 'x' })) }), false)
})

test('chat payload validation accepts the supported message envelope', () => {
  assert.equal(isValidChatPayload({ messages: [{ role: 'user', content: 'Ahoj' }] }), true)
})
