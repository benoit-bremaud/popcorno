# Security

## Reporting

Open a private security advisory on GitHub (Security → Advisories → Report a
vulnerability). Do not open a public issue for a vulnerability.

## What is scanned in CI

| Tool              | Scope                                           | Blocking |
| ----------------- | ----------------------------------------------- | -------- |
| Gitleaks          | Secrets, full history, every push + weekly      | yes      |
| CodeQL            | SAST on JavaScript/TypeScript                   | yes      |
| Dependency review | New CVEs introduced by dependency changes (PRs) | yes      |
| OSSF Scorecard    | Repository hygiene                              | no       |
| Hadolint          | Dockerfile lint (`make lint-docker`)            | yes      |
| Trivy config      | Dockerfile misconfigurations                    | yes      |
| Trivy image       | HIGH/CRITICAL fixable CVEs in the built image   | yes      |
| SonarQube         | Quality gate + coverage (local, pre-merge)      | yes      |

Accepted Trivy findings live in `.trivyignore.yaml`, each scoped (`paths`), time-boxed
(`expired_at`) and justified (`statement`). None at the moment.

Not scanned: third-party images referenced from `docker-compose.yml` (reviewed by hand on
Dependabot bumps).

## Runtime posture

- The container runs as a numeric non-root user with a `HEALTHCHECK` on `GET /health`.
- Secrets (TMDB key) come from environment variables only; `.env*` files are gitignored.
- Media paths are resolved under `MEDIA_ROOT` and validated against path traversal before
  any file is served or handed to FFmpeg.
