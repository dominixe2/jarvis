# Dependency audit validation

The JARVIS validation workflow includes `npm audit --audit-level=high` on Ubuntu after `npm ci`.

The audit must be run by GitHub Actions on this branch and the Ubuntu and Windows test/lint/build matrix must complete before this PR can be considered validated. A workflow file change alone is not evidence that the audit ran.
