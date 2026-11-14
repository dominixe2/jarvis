import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export function createPairingCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function safeEqualText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function isLocalNetworkHostname(hostname) {
  const normalized = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()

  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    return true
  }

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }

  if (isIP(normalized) === 6) {
    return normalized === '::1' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)
  }

  return false
}

export function isAllowedOrigin(origin, hostHeader) {
  if (!origin || !hostHeader) return false
  let originUrl
  let requestUrl
  try {
    originUrl = new URL(origin)
    requestUrl = new URL(originUrl.protocol + '//' + hostHeader)
  } catch {
    return false
  }

  if (!['http:', 'https:'].includes(originUrl.protocol)) return false
  if (originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search || originUrl.hash) return false
  if (requestUrl.username || requestUrl.password || requestUrl.pathname !== '/' || requestUrl.search || requestUrl.hash) return false
  if (requestUrl.protocol !== originUrl.protocol) return false
  if (originUrl.hostname !== requestUrl.hostname || originUrl.port !== requestUrl.port) return false
  if (!isLocalNetworkHostname(originUrl.hostname)) return false

  const port = Number(originUrl.port || (originUrl.protocol === 'https:' ? 443 : 80))
  return (port >= 5173 && port <= 5199) || (port >= 4173 && port <= 4199)
}

export function createSlidingWindowLimiter({
  limit = 30,
  windowMs = 60_000,
  maxKeys = 128,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer')
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError('windowMs must be positive')
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new TypeError('maxKeys must be a positive integer')

  const buckets = new Map()
  return (key) => {
    const id = typeof key === 'string' && key ? key : 'unknown'
    const timestamp = now()
    const recent = (buckets.get(id) || []).filter((entry) => timestamp - entry < windowMs)
    if (recent.length >= limit) {
      buckets.delete(id)
      buckets.set(id, recent)
      return false
    }
    recent.push(timestamp)
    buckets.delete(id)
    buckets.set(id, recent)
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value)
    return true
  }
}

export function createConcurrencyGate(maxActive = 2) {
  if (!Number.isInteger(maxActive) || maxActive < 1) throw new TypeError('maxActive must be a positive integer')
  let active = 0
  return {
    tryAcquire() {
      if (active >= maxActive) return null
      active += 1
      let released = false
      return () => {
        if (released) return
        released = true
        active -= 1
      }
    },
    get active() {
      return active
    },
  }
}

export function isValidChatPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Array.isArray(payload.messages) &&
    payload.messages.length <= 100 &&
    payload.messages.every((message) =>
      message &&
      typeof message === 'object' &&
      !Array.isArray(message) &&
      ['system', 'user', 'assistant'].includes(message.role) &&
      typeof message.content === 'string' &&
      message.content.length <= 100_000
    )
  )
}
