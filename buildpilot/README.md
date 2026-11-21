# BuildPilot

BuildPilot is an autonomous, resumable software-building worker. It accepts a task, works inside a designated project workspace, records its agent session and progress, and resumes unfinished work after a worker restart.

> Current stage: first working foundation. This is not yet a hosted, unattended service. The worker currently runs on the machine where Claude Agent SDK is authenticated. A remote deployment needs a persistent workspace/session store and a server-side model credential.

## Why it lives here for now

The JARVIS repository already includes `@anthropic-ai/claude-agent-sdk` and a Node runtime. BuildPilot is isolated under this directory so it can be extracted into its own repository later. The parent repository is public: never put secrets, private source, or personal data here.

## Requirements

- Node.js 20+
- Root dependencies installed with `npm ci`
- Claude Code authenticated on the machine that runs the worker
- One or more project checkouts inside the workspace directory

## Start

From the repository root:

```bash
npm ci
claude
# Sign in using the Claude Code login flow if this machine is not authenticated.
mkdir -p workspaces
# Put a Git checkout inside ./workspaces, for example ./workspaces/my-app
```

Set a strong local API token before starting the API:

```bash
# PowerShell
$env:BUILDPILOT_TOKEN = "replace-with-a-long-random-secret"
$env:BUILDPILOT_WORKSPACES_DIR = "$PWD/workspaces"
node buildpilot/src/server.mjs
```

In another terminal, run the worker:

```bash
$env:BUILDPILOT_WORKSPACES_DIR = "$PWD/workspaces"
node buildpilot/src/worker.mjs
```

Submit a task (PowerShell example):

```powershell
$body = @{
  task = "Build the settings screen and add tests"
  workspace = "my-app"
  acceptanceCriteria = @(
    "Settings can be opened from the main navigation",
    "Existing tests still pass",
    "Add tests for the new settings behavior"
  )
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8790/jobs `
  -Headers @{ Authorization = "Bearer $env:BUILDPILOT_TOKEN" } `
  -ContentType "application/json" -Body $body
```

List jobs:

```powershell
Invoke-RestMethod http://127.0.0.1:8790/jobs -Headers @{ Authorization = "Bearer $env:BUILDPILOT_TOKEN" }
```

## Safety model

- The API binds only to `127.0.0.1`; do not expose it publicly.
- Requests require a bearer token.
- Workspaces must be child directories of the configured workspace root.
- The agent can read and edit files only through its project-scoped tools.
- Shell commands are denied by default except for a short allowlist of project validation commands. Configure additional exact commands with `BUILDPILOT_ALLOWED_COMMANDS` only after reviewing the risk.
- No automatic merge, release, deployment, credential handling, or destructive cleanup.
- Each agent cycle has a turn and budget ceiling. Incomplete work is checkpointed and requeued instead of being reported as finished.

## Current limitations

1. The first version runs locally; it does not yet run on a remote server while the PC is off.
2. Claude Agent SDK requires a valid Claude Code login on the worker host. API usage and account limits still apply.
3. Job persistence is a local JSON store. A production multi-worker deployment needs a transactional database and shared session storage.
4. The worker does not claim a task is complete unless the agent emits the explicit completion marker after checking the acceptance criteria.
5. Human review is still required before merging or publishing generated software.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the planned hosted design.
