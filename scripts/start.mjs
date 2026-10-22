/**
 * One command to run JARVIS: start the Vite face and, when needed, its local
 * bridge. The Gemini and direct-API backends do not need the Claude bridge.
 *
 * Pass --writes only when using the bridge and you explicitly want tools that
 * can change files, send things, or control devices:
 *   npm start -- --writes
 */

import { spawn } from 'node:child_process'
import process from 'node:process'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'

/**
 * Vite loads .env.local itself, but this Node launcher runs before Vite and
 * does not inherit those values automatically. Read only VITE_BACKEND here so
 * selecting Gemini/direct mode doesn't start an unnecessary Claude process.
 * An explicit shell environment variable takes precedence, just as it does in
 * Vite. Unknown/missing values fall back to bridge, matching config.ts.
 */
function configuredBackend() {
  const fromProcess = process.env.VITE_BACKEND?.trim().toLowerCase()
  if (fromProcess) return fromProcess

  try {
    const file = readFileSync('.env.local', 'utf8')
    const match = file.match(/^\s*VITE_BACKEND\s*=\s*(.*?)\s*$/m)
    if (!match) return 'bridge'
    const value = match[1].replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase()
    return value || 'bridge'
  } catch {
    return 'bridge'
  }
}

/**
 * Put MediaPipe's WebAssembly where the page can load it. The runtime is copied
 * from the lockfile-pinned dependency and stays out of git.
 */
function vendorWasm() {
  const from = 'node_modules/@mediapipe/tasks-vision/wasm'
  const to = 'public/mediapipe'
  if (!existsSync(from)) return
  if (existsSync(`${to}/vision_wasm_internal.wasm`)) return
  try {
    mkdirSync(to, { recursive: true })
    cpSync(from, to, { recursive: true })
    console.log('  vendored the hand-tracking runtime into public/mediapipe.')
  } catch (err) {
    console.warn(`  could not vendor the hand-tracking runtime: ${err.message}`)
  }
}

const writes = process.argv.includes('--writes')
const backend = configuredBackend()
const needsBridge = backend !== 'gemini' && backend !== 'direct'
const needsGeminiProxy = true // also enables the settings panel to store a key before switching backends

// A dim label per process, so the interleaved logs stay readable.
const paint = (tag, colour) => (line) =>
  line
    .toString()
    .split('\n')
    .filter((l) => l.length)
    .map((l) => `\x1b[${colour}m${tag}\x1b[0m ${l}`)
    .join('\n')

const children = []

function run(name, command, args, colour, env) {
  const label = paint(name, colour)
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    shell: false,
  })
  child.stdout.on('data', (d) => process.stdout.write(label(d) + '\n'))
  child.stderr.on('data', (d) => process.stderr.write(label(d) + '\n'))
  child.on('error', (err) => {
    console.error(`[${name}] failed to start: ${err.message}`)
    shutdown(1)
  })
  child.on('exit', (code) => {
    console.log(`\x1b[${colour}m${name}\x1b[0m exited (${code}); stopping the rest.`)
    shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const c of children) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

/**
 * When the bridge is enabled, tell it which port the face uses. This keeps the
 * origin allowlist narrow if Vite selects a non-default development port.
 */
const port = process.env.PORT
const bridgeEnv = writes ? { JARVIS_ALLOW_WRITES: '1' } : {}
if (port && needsBridge) {
  bridgeEnv.JARVIS_ALLOWED_ORIGINS = `http://localhost:${port},http://127.0.0.1:${port}`
  console.log(`  serving the face on port ${port}; the bridge will accept it.\n`)
}

vendorWasm()

console.log(`\nJ.A.R.V.I.S. starting — backend: ${backend}.${needsBridge ? ' Local bridge enabled.' : ' Local bridge not needed.'}\n`)
if (needsBridge) {
  run('bridge', 'node', ['bridge/server.mjs'], '36', bridgeEnv)
}

// npm is a shell script on most systems; call Vite directly so shell quoting is
// not needed and process arguments behave consistently on Windows.
run('face', process.execPath, ['node_modules/vite/bin/vite.js'], '35', {})

console.log(
  '\nWhen the dev server is ready, open the URL it prints in Chrome,\n' +
    'click INITIALISE, and say "Hey Jarvis". Ctrl-C stops everything.\n',
)
