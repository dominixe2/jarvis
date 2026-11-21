import { query } from '@anthropic-ai/claude-agent-sdk'
import { claimNextJob, recoverInterruptedJobs, updateJob } from './store.mjs'
import { authorizeTool } from './policy.mjs'

const POLL_MS = Number(process.env.BUILDPILOT_POLL_MS || 5000)
const MAX_TURNS = Number(process.env.BUILDPILOT_MAX_TURNS || 18)
const MAX_BUDGET_USD = Number(process.env.BUILDPILOT_MAX_BUDGET_USD || 3)
let stopping = false

function makePrompt(job) {
  const criteria = job.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n')
  return [
    'You are BuildPilot, an autonomous software engineer working only inside the current project directory.',
    'Implement the user task, inspect the existing project first, run relevant allowed checks, fix failures, and verify the acceptance criteria.',
    'Do not claim completion if a criterion is unverified. Do not access secrets or files outside the project.',
    'Do not deploy, publish, merge, delete project data, or change external services.',
    '',
    'USER TASK:',
    job.task,
    '',
    'ACCEPTANCE CRITERIA:',
    criteria || 'Define sensible, observable acceptance criteria from the task and verify them.',
    '',
    'When every criterion is implemented and checked, end your final response with the exact marker BUILD_PILOT_DONE.',
    'If work remains, summarize the concrete remaining work and end with BUILD_PILOT_CONTINUE.',
  ].join('\n')
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
        canUseTool: authorizeTool,
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
        finalResult = message.result || ''
      }
    }

    const completed = finalResult.includes('BUILD_PILOT_DONE')
    if (completed) {
      await updateJob(job.id, {
        status: 'completed',
        sessionId,
        lastError: null,
        result: finalResult,
      }, {
        type: 'completed',
        message: 'Agent reported completion after checking the acceptance criteria.',
      })
      return
    }

    if (job.attempts >= job.maxAttempts) {
      await updateJob(job.id, {
        status: 'needs_attention',
        sessionId,
        result: finalResult,
        lastError: `Continuation limit reached (last result: ${resultSubtype || 'no result'}).`,
      }, {
        type: 'needs_attention',
        message: 'Automatic continuation limit reached; human review is required.',
      })
      return
    }

    await updateJob(job.id, {
      status: 'queued',
      sessionId,
      result: finalResult,
      lastError: resultSubtype && resultSubtype !== 'success' ? `Agent ended with ${resultSubtype}.` : null,
    }, {
      type: 'checkpoint',
      message: 'Work is incomplete; job saved for another bounded cycle.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const exhausted = job.attempts >= job.maxAttempts
    await updateJob(job.id, {
      status: exhausted ? 'needs_attention' : 'queued',
      sessionId,
      lastError: message.slice(0, 2000),
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
  const recovered = await recoverInterruptedJobs()
  console.log(`[BuildPilot] worker online; recovered ${recovered} interrupted job(s)`)
  while (!stopping) {
    const job = await claimNextJob()
    if (job) {
      console.log(`[BuildPilot] running ${job.id} in ${job.workspace}`)
      await runJob(job)
    } else {
      await sleep(POLL_MS)
    }
  }
  console.log('[BuildPilot] worker stopped')
}

process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

main().catch((error) => {
  console.error('[BuildPilot] fatal worker error:', error)
  process.exitCode = 1
})
