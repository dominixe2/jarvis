import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'

const DEFAULT_COMMANDS = new Set(['git status --short', 'git diff --check'])
const SENSITIVE_DIRECTORIES = new Set([
  '.git', '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker',
  '.config', 'secrets', 'secret', 'credentials',
])
const SAFE_ENV_EXAMPLES = new Set(['.env.example', '.env.sample', '.env.template'])
const SENSITIVE_FILES = new Set([
  '.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519', 'id_ecdsa',
  'credentials.json', 'service-account.json',
])

function isSensitiveSegment(segment) {
  const name = segment.toLowerCase()
  if (SENSITIVE_DIRECTORIES.has(name)) return true
  if (SAFE_ENV_EXAMPLES.has(name)) return false
  if (name === '.env' || name.startsWith('.env.')) return true
  if (SENSITIVE_FILES.has(name)) return true
  if (/^id_(rsa|ed25519|ecdsa)(\.pub)?$/i.test(name)) return true
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i.test(name)) return true
  if (/(^|[-_.])(secret|credential|access[_-]?token|refresh[_-]?token)([-_.]|$)/i.test(name)) return true
  return false
}

function isSensitivePath(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).some(isSensitiveSegment)
}

function isInside(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

function hasUnsafeGlob(pattern) {
  if (typeof pattern !== 'string' || !pattern.trim()) return true
  const normalised = pattern.replace(/\\/g, '/')
  if (normalised.startsWith('/') || /^[A-Za-z]:\//.test(normalised)) return true
  if (normalised.split('/').includes('..')) return true
  return isSensitivePath(normalised)
}

/**
 * Check a tool path against the canonical workspace. Existing symlinks are
 * rejected instead of followed, including symlinks that point back inside.
 * Missing leaf paths are allowed for Write operations.
 */
export async function isAllowedWorkspacePath(workspace, candidate, { allowRoot = false } = {}) {
  if (typeof workspace !== 'string' || !workspace || typeof candidate !== 'string' || !candidate.trim()) {
    return false
  }
  try {
    const root = await realpath(workspace)
    if (!isAbsolute(candidate) && win32.isAbsolute(candidate)) return false
    const target = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate)
    if (!isInside(root, target)) return false
    const rel = relative(root, target)
    if (!rel && !allowRoot) return false
    if (isSensitivePath(rel)) return false

    let current = root
    for (const segment of rel.split(sep).filter(Boolean)) {
      current = join(current, segment)
      try {
        const info = await lstat(current)
        if (info.isSymbolicLink()) return false
      } catch (error) {
        if (error?.code === 'ENOENT') break
        return false
      }
    }

    try {
      const canonicalTarget = await realpath(target)
      if (!isInside(root, canonicalTarget)) return false
    } catch (error) {
      if (error?.code !== 'ENOENT') return false
    }
    return true
  } catch {
    return false
  }
}

export function allowedCommands() {
  const configured = (process.env.BUILDPILOT_ALLOWED_COMMANDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return new Set([...DEFAULT_COMMANDS, ...configured])
}

export function isAllowedCommand(command) {
  if (typeof command !== 'string') return false
  const normalised = command.trim().replace(/\s+/g, ' ')
  if (!normalised || /[;&|<>\n\r]/.test(normalised)) return false
  if (normalised.includes(String.fromCharCode(96))) return false
  if (normalised.includes('$(') || normalised.includes('$' + '{')) return false
  return allowedCommands().has(normalised)
}

const deny = (message) => ({ behavior: 'deny', message })

export async function authorizeTool(toolName, input = {}, { workspace } = {}) {
  if (['Read', 'Edit', 'Write'].includes(toolName)) {
    if (!await isAllowedWorkspacePath(workspace, input.file_path)) {
      return deny('BuildPilot blocked a file path outside the approved workspace or in a protected location.')
    }
    return { behavior: 'allow' }
  }

  if (toolName === 'Glob') {
    if (hasUnsafeGlob(input.pattern)) {
      return deny('BuildPilot blocked an unsafe or sensitive file pattern.')
    }
    const searchPath = typeof input.path === 'string' && input.path.trim() ? input.path : workspace
    if (!await isAllowedWorkspacePath(workspace, searchPath, { allowRoot: true })) {
      return deny('BuildPilot blocked a search path outside the approved workspace.')
    }
    return { behavior: 'allow' }
  }

  // The SDK Grep tool recursively reads contents without a mandatory exclusion
  // list. Keep it disabled until secret-file exclusions can be enforced.
  if (toolName === 'Grep') {
    return deny('BuildPilot content-wide Grep is disabled; use scoped Glob and Read operations.')
  }

  if (toolName === 'Bash' && isAllowedCommand(input.command)) {
    return { behavior: 'allow' }
  }

  return deny('BuildPilot policy blocked this tool or shell command. Add an exact reviewed command to BUILDPILOT_ALLOWED_COMMANDS only when its effects are understood.')
}
