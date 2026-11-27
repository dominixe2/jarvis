# BuildPilot security regression matrix

Review and run these checks through BuildPilot validation:

- Workspace path traversal and symlink rejection.
- Denial of credential-file paths.
- Shell-command allowlist enforcement and disabled recursive Grep.
- Host/Origin/Fetch Metadata and bearer-token validation.
- UTF-8 request-size limits and safe error redaction.
- Atomic store locking, corrupt-store fail-closed behavior and single-worker lease.
- Job completion requires human approval; no autonomous merge or deployment.

Workspace path guards are not an OS sandbox. Use a dedicated low-privilege account and isolated workspaces before any remote operation.
