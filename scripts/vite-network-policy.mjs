/**
 * Keep the Vite development server loopback-only unless both HTTPS files exist.
 * A LAN listener over plaintext HTTP is never an accepted mode.
 */
export function resolveViteNetworkPolicy(certPath, keyPath) {
  const hasCert = typeof certPath === 'string' && certPath.trim().length > 0
  const hasKey = typeof keyPath === 'string' && keyPath.trim().length > 0

  if (hasCert !== hasKey) {
    throw new Error('JARVIS_HTTPS_CERT and JARVIS_HTTPS_KEY must both be configured.')
  }

  return {
    host: hasCert ? '0.0.0.0' : '127.0.0.1',
    httpsEnabled: hasCert,
  }
}
