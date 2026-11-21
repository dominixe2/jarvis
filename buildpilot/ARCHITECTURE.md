# BuildPilot architecture

## Goal

Turn a user request into a durable engineering job that can survive browser disconnects, worker restarts, and bounded model sessions. A job is complete only when its acceptance criteria are checked and the agent emits the explicit completion marker.

## First implementation

- **HTTP API**: local-only task submission and job status.
- **Durable queue**: atomic JSON job store with status, attempts, event history, and Claude session ID.
- **Worker**: claims one job at a time and runs a bounded Claude Agent SDK session.
- **Resume**: the saved session ID is passed back to the SDK after a restart or turn-limit boundary.
- **Guardrails**: workspace-root restriction, bearer token, command allowlist, bounded turns and budget.
- **Completion contract**: `BUILD_PILOT_DONE` is required; otherwise the task is requeued or marked as needing attention.

## Job lifecycle

```text
queued -> running -> completed
                  -> queued (bounded continuation / recoverable interruption)
                  -> needs_attention (retry ceiling / unrecoverable error)
```

A worker restart converts stale `running` jobs back to `queued` while preserving the agent session ID.

## Next stages

1. Replace local JSON persistence with PostgreSQL and a transactional claim/lease.
2. Move workspaces into isolated ephemeral containers with persistent per-job volumes.
3. Add provider adapters (Gemini, Groq, Mistral, Claude) with explicit model/limit selection.
4. Add GitHub integration: create a task branch, push commits, run CI, inspect failures, and open a draft PR.
5. Add a dashboard for queue, live events, budgets, retries, diffs, and approvals.
6. Deploy the API and worker to a persistent host only after secrets, workspace isolation, backups, and cost controls are in place.

## Non-goals

- Infinite execution without budgets or stop conditions.
- Silent merging or deployment.
- Arbitrary host shell access.
- Claiming that an app is finished merely because the model stopped responding.
