import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  acquireWorkerLease,
  claimNextJob,
  recoverInterruptedJobs,
  updateJob,
} from './store.mjs'
import { authorizeTool } from './policy.mjs'

function boundedNumber(value, fallback, minimum, maximum, integer = false) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const bounded = Math.min(maximum, Math.max(minimum, parsed))
  return integer ? Math.trunc(bounded) : bounded
}

const POLL_MS = boundedNumber(process.env.BUILDPILOT_POLL_MS, 5000, 1000, 60000, true)
const MAX_TURNS = boundedNumber(process.env.BUILDPILOT_MAX_TURNS, 18, 1, 30, true)
const MAX_BUDGET_USD = boundedNumber(process.env.BUILDPILOT_MAX_BUDGET_USD, 3, 0.25, 10)
const MAX_RESULT_CHARS = 20000
let stopping = false

function makePrompt(job) {
  const criteria = (Array.isArray(job.acceptanceCriteria) ? job.acceptanceCriteria : [])
    .map((item, index) => String(index + 1) + '. ' + item)
    .join('\n')
  return [
    'You are BuildPilot, a software engineer working only inside the current project directory.',
    'Inspect the project first, implement the task, run only permitted checks, fix failures, and verify each acceptance criterion.',
    'Do not access secrets, hidden credential files, or files outside the project.',
    'Do not deploy, publish, merge, delete project data, or change external services.',
    '',
    'USER TASK:',
    job.task,
    '',
    'ACCEPTANCE CRITERIA:',
    criteria || 'Define observable acceptance criteria from the task and verify them.',
    '',
    'When all criteria appear satisfied, end the final response with the exact marker BUILD_PILOT_DONE on its own final line.',
    'If work remains, end with BUILD_PILOT_CONTINUE.',
    'The marker only requests human review; it does not approve or publish the work.',
  ].join('\n')
}

function safeErrorCode(error) {
  const candidate = error && typeof error.code === 'string'
    ? error.code
    : error && typeof error.name === 'string'
      ? error.name
      : ''
  return /^[A-Z0-9_]{1,40}$/.test(candidate) ? candidate : 'WORKER_ERROR'
}

function hasCompletionMarker(result) {
  const lines = String(result || '').trim().split(/\r?\n/)
  return lines.at(-1) === 'BUILD_PILOT_DONE'
}

async function runJob(job) {
  const workspace = job.workspace
  await updateJob(job.id, { status: 'running', lastError: null }, {
    type: 'agent_started',
    message: job.sessionId ? 'Resuming saved agent session.' : 'Starting a new agent session.',
  })

  let sessionId = job.sessionId
  let finalResult = ''
  let resultSubtype = null
  try {
    const stream = query({
      prompt: makePrompt(job),
      options: {
        cwd: workspace,
        model: process.env.BUILDPILOT_MODEL || process.env.JARVIS_MODEL || 'claude-opus-5',
        maxTurns: MAX_TURNS,
        maxBudgetUsd: MAX_BUDGET_USD,
        permissionMode: 'default',
        allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
        canUseTool: (toolName, input) => authorizeTool(toolName, input, { workspace }),
        ...(sessionId ? { resume: sessionId } : {}),
      },
    })

    for await (const message of stream) {
      if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
        sessionId = message.session_id
        await updateJob(job.id, { sessionId }, {
          type: 'session_saved',
          message: 'Agent session checkpoint saved.',
        })
      }
      if (message.type === 'result') {
        sessionId = message.session_id || sessionId
        resultSubtype = message.subtype
        finalResult = String(message.result || '').slice(0, MAX_RESULT_CHARS)
      }
    }

    if (hasCompletionMarker(finalResult)) {
      await updateJob(job.id, {
        status: 'needs_review',
        sessionId,
        lastError: null,
        result: finalResult,
      }, {
        type: 'awaiting_review',
        message: 'Agent requested completion; a human must review and approve the result.',
      })
      return
    }

    if (job.attempts >= job.maxAttempts) {
      await updateJob(job.id, {
        status: 'needs_attention',
        sessionId,
        result: finalResult,
        lastError: ('CONTINUATION_LIMIT_' + (resultSubtype || 'NO_RESULT')).slice(0, 80),
      }, {
        type: 'needs_attention',
        message: 'Continuation limit reached; human review is required.',
      })
      return
    }

    await updateJob(job.id, {
      status: 'queued',
      sessionId,
      result: finalResult,
      lastError: resultSubtype && resultSubtype !== 'success'
        ? ('AGENT_RESULT_' + String(resultSubtype).replace(/[^A-Z0-9_]/gi, '_').toUpperCase().slice(0, 32))
        : null,
    }, {
      type: 'checkpoint',
      message: 'Work is incomplete; job saved for another bounded cycle.',
    })
  } catch (error) {
    const code = safeErrorCode(error)
    const exhausted = job.attempts >= job.maxAttempts
    await updateJob(job.id, {
      status: exhausted ? 'needs_attention' : 'queued',
      sessionId,
      lastError: code,
    }, {
      type: exhausted ? 'needs_attention' : 'retry_scheduled',
      message: exhausted
        ? 'Repeated worker failure; human review is required.'
        : 'Worker failed; job remains resumable and will be retried.',
    })
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const releaseLease = await acquireWorkerLease()
  try {
    const recovered = await recoverInterruptedJobs()
    console.log('[BuildPilot] worker online; recovered ' + recovered + ' interrupted job(s)')
    while (!stopping) {
      const job = await claimNextJob()
      if (job) {
        console.log('[BuildPilot] running job ' + job.id)
        await runJob(job)
      } else {
        await sleep(POLL_MS)
      }
    }
    console.log('[BuildPilot] worker stopped')
  } finally {
    await releaseLease()
  }
}

process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

main().catch(() => {
  console.error('[BuildPilot] worker stopped after an internal error.')
  process.exitCode = 1
})
