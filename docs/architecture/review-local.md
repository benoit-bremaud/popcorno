# Local review — popcorntv (#27 rename)

- Date: 2026-10-24
- Commit: 89b9af8
- Scope: branch diff `origin/main...chore/27-rename-popcorntv` (71 files, 113 +/113 −)
- Checks run: correctness · security (diff read) · execution gate. Design / docs / tests
  agents skipped as disproportionate: the diff is a pure string substitution
  (`Popcorno` → `PopCornTV`, `popcorno` → `popcorntv`) with no logic change.
- Verdict: ship as-is · Must 0 · Should 0 · Nice 0

## Pre-merge gate (head SHA 89b9af8)

| Step | Result |
|---|---|
| 1 Tests | ✅ 19 shared · 270 server · 100 web (Vitest); typecheck, lint, format, build green |
| 2 Coverage | statements: shared 100 % · server 98.1 % · web 99.7 % (floor 80) |
| 3 SonarQube | ✅ PASSED — key renamed `popcorno` → `popcorntv` server-side (history kept) |
| 4 Secrets | ✅ gitleaks clean (`origin/main..HEAD`) · only `.env.example` tracked · diff read: rename only |
| 5 QA pass | ✅ smoke — built bundle shows `<title>PopCornTV` and the `PopCornTV` brand heading |

- Gate: **GREEN — merge authorised**

## 🔴 Must Have

_None._

## 🟡 Should Have

_None._

## 🔵 Nice to Have

_None._

## ⚪ Disagree / Intentional

- `PROJECT_LOG.md`, `docs/architecture/qa/**` `[docs]` · keep "Popcorno" · historical
  records of what happened under the old name; a rename entry is added after merge.
- `data/popcorntv.sqlite`, volume `popcorntv-data` `[correctness]` · old local data is not
  migrated · no production deployment exists yet.

## Per-dimension summary

- Design: n/a · Docs: names updated, history kept · Tests: all green, temp prefixes renamed ·
  Security: no new surface · Correctness: substitution complete outside history files.
