# Local review — popcorno (issue #9 resume playback)

- Date: 2026-10-24
- Commit reviewed: 41cfe9d · fixes: `fix(playback): apply the #9 local review`
- Scope: branch diff `origin/main...HEAD` (packages/shared `playback.ts`; apps/server `db/schema.ts`,
  migration 0004, `progress/*`, `playback/{ffmpeg-args,session-manager,session-routes}.ts`,
  `library/repository.ts`, `app.ts`; apps/web `api.ts`, `catalog/{DetailDialog,catalog}.tsx?`,
  `playback/{PlayerDialog,resume}`, styles; docs: spec, ADR-0007, sequence, class, component)
- Checks run: design (`architecture-guardian`) · docs (`doc-auditor`) · tests (`test-auditor`) ·
  security (Opus pass) · correctness (review pass)
- Verdict: ship after the fixes below (all applied) · Must 0 · Should 14 (fixed) · Nice 6

## Pre-merge gate (pre-push run, head of the fix commit)

| Step | Result |
|---|---|
| 1 Tests | ✅ shared 19 · server 270 · web 98 (Vitest); no E2E change |
| 2 Coverage | server 98.1 % stmts / 95.5 % branches / 95 % funcs / 98.3 % lines · web 99.7 / 93.8 / 100 / 100 · docs ≈ 97 % (estimate, doc-auditor) |
| 3 SonarQube | ✅ PASSED (first run FAILED: S7503 async without await in `progress/routes.ts`, then a stale web lcov; both fixed) |
| 4 Secrets | ✅ gitleaks clean (`--all`, 27 commits) · only `.env.example` tracked · diff read: nothing sensitive |
| 5 QA pass | ⏳ run at the pre-merge gate on the merged SHA (Chromium + Firefox, inspector pass) |

- Gate: **push authorised** — QA (step 5) pending for the merge.

## 🔴 Must Have

_None._

## 🟡 Should Have (all fixed in the fix commit)

- `apps/web/src/playback/PlayerDialog.tsx` `[correctness]` · a pause or close before `loadedmetadata`
  saved position 0 and erased the resume point · no position before the first metadata + seek.
- `apps/web/src/catalog/DetailDialog.tsx` `[correctness|design]` · the close-time `GET /progress`
  could beat the last keepalive `PUT` · `onClose(saved)` and refresh after it settles; latest request wins.
- `apps/web/src/catalog/DetailDialog.tsx` `[correctness]` · Play before progress loaded started at 0
  and overwrote the resume point · actions render once progress answered.
- `apps/server/src/playback/session-routes.ts` `[security]` · unbounded `startSec` past the end held
  a transcode slot · capped at one week; at or past the duration → start over.
- `apps/server/src/progress/routes.ts` `[security]` · unbounded `positionSec` · same one-week cap.
- `apps/web/src/playback/PlayerDialog.tsx` `[correctness]` · growing HLS duration offered Next
  episode too early · element duration used in direct play only.
- `apps/web/src/api.ts` `[design]` · four positional args with a boolean · `startPlayback(body, fetch)`.
- `apps/web/src/playback/PlayerDialog.tsx` `[design]` · offset fallback written three times · one `offsetSec`.
- `apps/server/src/db/schema.ts` `[design]` · `'default'` profile defined twice · one `DEFAULT_PROFILE`.
- `apps/server/src/progress/routes.ts:28` `[sonar]` · S7503 · non-async handler.
- `apps/server/src/playback/session-manager.ts`, `session-routes.ts` `[docs]` · `startSec` /
  `offsetSec` contract missing, long lines · re-wrapped docstrings.
- tests `[tests]` · next-episode resume-point wiring, refresh after close, offset/duration fallback,
  save-count, series 404 at route level, nothing saved before metadata · added.

## 🔵 Nice to Have

- `apps/web/src/playback/PlayerDialog.tsx` `[correctness]` · hls.js 404 flash when moving to the
  next episode · fixed (`leaving` ref).
- `PlayerDialog.tsx` `[design]` · three reasons to change (UC5/6/7) · extract a `useWatchProgress`
  hook when seek-ahead lands.
- `apps/server/src/progress/*.test.ts` `[tests]` · `progressDb` fixture duplicated · kept: a shared
  non-test helper would ship in the build.
- `session-routes.test.ts` `[tests]` · `-ss` asserted by index · kept (argument order is the contract).
- `GET /progress` `[security]` · no auth, no limit · tracked with #10 / #18 (loopback by default).
- No rate limit on `PUT` progress `[security]` · one upsert per key, bounded.

## ⚪ Disagree / Intentional

- `apps/web/src/playback/PlayerDialog.tsx` `[correctness]` · copy-mode `-ss` lands on the previous
  keyframe, so positions can run up to one GOP ahead · accepted in spec 4a / ADR-0007 §2 until seek-ahead.
- `apps/server/src/progress/repository.ts` `[design]` · rules in the repository, no service · flat
  layering (CLAUDE.md), a forwarding service is refused by the architecture doctrine.

## Per-dimension summary

- Design: no over-engineering, no dependency-rule break; four local fixes.
- Docs: ≈ 97 % presence, no stale doc; contract and wrapping fixes.
- Tests: healthy pyramid, doubles only on boundaries; missing behaviours added.
- Security: no injection (argv without shell, Drizzle params); bounds added.
- Correctness: four real ordering / early-save bugs, all fixed.
