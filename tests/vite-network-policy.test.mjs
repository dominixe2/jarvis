import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveViteNetworkPolicy } from '../scripts/vite-network-policy.mjs'

test('Vite binds only to loopback when no HTTPS certificate is configured', () => {
  assert.deepEqual(resolveViteNetworkPolicy(undefined, undefined), {
    host: '127.0.0.1',
    httpsEnabled: false,
  })
})

test('Vite enables LAN access only when both HTTPS files are configured', () => {
  assert.deepEqual(resolveViteNetworkPolicy('cert.pem', 'key.pem'), {
    host: '0.0.0.0',
    httpsEnabled: true,
  })
})

test('Vite rejects an incomplete HTTPS certificate pair', () => {
  assert.throws(
    () => resolveViteNetworkPolicy('cert.pem', undefined),
    /JARVIS_HTTPS_CERT and JARVIS_HTTPS_KEY must both be configured/,
  )
  assert.throws(
    () => resolveViteNetworkPolicy(undefined, 'key.pem'),
    /JARVIS_HTTPS_CERT and JARVIS_HTTPS_KEY must both be configured/,
  )
})

test('blank certificate paths do not accidentally enable LAN access', () => {
  assert.deepEqual(resolveViteNetworkPolicy('  ', ''), {
    host: '127.0.0.1',
    httpsEnabled: false,
  })
})
