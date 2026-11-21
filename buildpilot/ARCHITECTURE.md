# BuildPilot architecture

## Goal

Turn a user request into a durable engineering job that survives browser disconnects, worker restarts and bounded model sessions. Agent completion is only a request for human review; a separate authenticated approval is required before the job is marked completed.

## First implementation

- **HTTP API:** loopback-only task submission and job status.
- **Request boundary:** bearer-token authentication, constant-time token comparison, strict Host/Origin/Fetch Metadata checks and a 64 KiB UTF-8 byte limit.
- **Workspace boundary:** canonical workspace-root validation plus per-tool path checks; symlinks and common credential paths are denied.
- **Tool policy:** default shell access is limited to non-executing Git status/diff checks; additional exact commands require explicit operator configuration. Recursive Grep is disabled.
- **Durable queue:** atomic JSON writes, inter-process store lock, fail-closed corruption handling, bounded event history and session checkpoints.
- **Worker lease:** only one worker process can run; startup recovery cannot requeue a job owned by another worker.
- **Worker:** one bounded Claude Agent SDK cycle at a time with capped turns, budget and retries.
- **Review gate:** the agent can move a job to needs_review; only an explicit bearer-authenticated human approval can move it to completed.

## Job lifecycle

    queued -> running -> needs_review -> completed
                      -> queued (bounded continuation / recoverable interruption)
                      -> needs_attention (retry ceiling / unrecoverable error)

A worker restart converts stale running jobs back to queued while preserving the agent session ID. The single-worker lease is acquired before recovery.

## Security limits

Workspace path checks are defense in depth, not a process sandbox. A dedicated low-privilege OS account and isolated workspaces are still required. Allowing a project shell command can execute repository-controlled code with the worker's OS privileges. Local JSON persistence is single-host only and is not a substitute for a transactional multi-host queue.

## Next stages

1. Replace local JSON persistence with PostgreSQL and transactional job leases.
2. Move workspaces into isolated ephemeral containers with persistent per-job volumes and minimal environment variables.
3. Add provider adapters (Gemini, Groq, Mistral, Claude) with explicit model and limit selection.
4. Add GitHub integration: create a task branch, push commits, run CI, inspect failures and open a draft PR.
5. Add a dashboard for queue, live events, budgets, retries, diffs and approvals.
6. Deploy only after secrets, workspace isolation, backups, cost controls and human approval gates are independently reviewed.

## Non-goals

- Infinite execution without budgets or stop conditions.
- Silent merging, publishing or deployment.
- Arbitrary host shell access by default.
- Treating an LLM completion marker as proof of correctness.
- Claiming an app is finished merely because the model stopped responding.
