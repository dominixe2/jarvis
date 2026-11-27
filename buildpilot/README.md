# BuildPilot

BuildPilot is a local, resumable software-building worker. It accepts a task, works inside a designated project workspace, records its agent session and progress, and resumes unfinished work after a worker restart.

> Current stage: security-hardened local foundation, not a hosted unattended service. The worker runs on the machine where Claude Agent SDK is authenticated. Remote operation needs persistent isolated workspaces, shared session storage, provider credentials, budget controls and human approval gates.

## Why it lives here for now

The JARVIS repository already includes @anthropic-ai/claude-agent-sdk and a Node runtime. BuildPilot is isolated under this directory so it can be extracted later. The parent repository is public: never put secrets, private source or personal data here.

## Requirements

- Node.js 20+
- Root dependencies installed with npm ci
- Claude Code authenticated on the worker host
- Project checkouts inside the workspace directory
- A dedicated low-privilege OS account is strongly recommended

## Start

From the repository root:

    npm ci
    claude
    # Sign in using the Claude Code login flow if this machine is not authenticated.
    mkdir -p workspaces
    # Put a Git checkout inside ./workspaces, for example ./workspaces/my-app

Set a random local API token (at least 32 characters) before starting the API:

    $env:BUILDPILOT_TOKEN = "replace-with-a-long-random-secret"
    $env:BUILDPILOT_WORKSPACES_DIR = "$PWD/workspaces"
    node buildpilot/src/server.mjs

In another terminal, run the worker:

    $env:BUILDPILOT_WORKSPACES_DIR = "$PWD/workspaces"
    node buildpilot/src/worker.mjs

Submit a task:

    $body = @{
      task = "Build the settings screen and add tests"
      workspace = "my-app"
      acceptanceCriteria = @(
        "Settings can be opened from the main navigation",
        "Existing tests still pass",
        "Add tests for the new settings behavior"
      )
    } | ConvertTo-Json

    Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8790/jobs -Headers @{ Authorization = "Bearer $env:BUILDPILOT_TOKEN" } -ContentType "application/json" -Body $body

List jobs:

    Invoke-RestMethod http://127.0.0.1:8790/jobs -Headers @{ Authorization = "Bearer $env:BUILDPILOT_TOKEN" }

A job that the agent believes is ready ends in **needs_review**. Inspect its result first, then explicitly approve it:

    $approval = @{ approved = $true } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8790/jobs/JOB_ID/approve" -Headers @{ Authorization = "Bearer $env:BUILDPILOT_TOKEN" } -ContentType "application/json" -Body $approval

Only a human approval changes needs_review to completed. This does not merge, publish or deploy anything.

## Security model

- The API binds only to 127.0.0.1; do not expose it publicly.
- Every request requires a bearer token; token comparison uses a constant-time byte comparison after a fixed-length check.
- Host, Origin and Fetch Metadata checks defend the local API against DNS rebinding and browser cross-site requests.
- JSON request bodies are capped at 64 KiB by actual UTF-8 byte count, not JavaScript character count.
- Workspaces must be existing child directories of the configured root; canonical paths are checked.
- Read/Edit/Write tools are restricted to paths inside the workspace. Existing symlinks and common credential locations (including .env, .git, SSH/cloud credentials and private-key files) are denied.
- Recursive content Grep is disabled because the SDK tool does not provide a mandatory secret-file exclusion boundary.
- Default shell access is limited to git status --short and git diff --check. Other exact commands require explicit BUILDPILOT_ALLOWED_COMMANDS configuration. Commands such as npm test execute repository-controlled scripts and must be treated as code execution, not inherently safe validation.
- The JSON job store uses an inter-process write lock, exclusive private temporary files and fail-closed corruption handling. Only one worker process may hold the worker lease.
- The agent's completion marker only requests review. A bearer-authenticated human approval is required before a job is marked completed.
- Turn, budget and retry settings are bounded. There is no automatic merge, release, deployment or destructive cleanup.

**Important limitation:** tool-path checks are defense in depth, not an OS sandbox. A local process running as the same OS user can still access that user's files. Do not run BuildPilot under an account that holds unrelated credentials or sensitive personal data. Explicitly allowing project shell commands also permits repository scripts to execute with the worker's OS privileges.

## Current limitations

1. This version runs locally; it does not run remotely while the PC is off.
2. Claude Agent SDK requires a valid Claude Code login on the worker host. Account and model usage limits still apply.
3. Job persistence is a single-host JSON store. A hosted multi-worker deployment needs a transactional database, leases and shared session storage.
4. Real OS/container isolation, a web dashboard, provider adapters and remote workspace lifecycle are not implemented.
5. Human review remains required before generated changes are merged or published.

See ARCHITECTURE.md for the planned hosted design.
