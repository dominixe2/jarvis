import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createConcurrencyGate,
  createPairingCode,
  createSessionToken,
  createSlidingWindowLimiter,
  hashSessionToken,
  isAllowedOrigin,
  isValidChatPayload,
  safeEqualText,
} from '../scripts/ollama-security.mjs'

test('pairing code is six numeric digits and session token has 256 bits of entropy', () => {
  assert.match(createPairingCode(), /^\d{6}$/)
  const first = createSessionToken()
  const second = createSessionToken()
  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first, second)
})

test('session values are stored as deterministic SHA-256 hashes and compared safely', () => {
  const token = createSessionToken()
  const hash = hashSessionToken(token)
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(hashSessionToken(token), hash)
  assert.equal(safeEqualText('654321', '654321'), true)
  assert.equal(safeEqualText('654321', '654322'), false)
  assert.equal(safeEqualText('654321', '6'), false)
  assert.equal(safeEqualText(undefined, '654321'), false)
})

test('origin validation accepts loopback, private LAN, ULA and local hostnames', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', '127.0.0.1:5173'), true)
  assert.equal(isAllowedOrigin('http://10.0.0.5:5173', '10.0.0.5:5173'), true)
  assert.equal(isAllowedOrigin('http://172.16.4.5:5173', '172.16.4.5:5173'), true)
  assert.equal(isAllowedOrigin('http://192.168.1.10:5173', '192.168.1.10:5173'), true)
  assert.equal(isAllowedOrigin('https://[fd12::1]:4173', '[fd12::1]:4173'), true)
  assert.equal(isAllowedOrigin('https://jarvis.local:4173', 'jarvis.local:4173'), true)
})

test('origin validation rejects public hosts even when Origin and Host match', () => {
  assert.equal(isAllowedOrigin('https://attacker.example:5173', 'attacker.example:5173'), false)
  assert.equal(isAllowedOrigin('http://8.8.8.8:5173', '8.8.8.8:5173'), false)
  assert.equal(isAllowedOrigin('https://203.0.113.10:5173', '203.0.113.10:5173'), false)
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
