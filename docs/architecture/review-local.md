# Local review — popcorno (issue #8 HLS transcode)

- Date: 2026-10-24
- Commit reviewed: 4a29709 · fixes: 91f4197 `fix(playback): hold the transcode limit under concurrent opens`
- Scope: branch diff `origin/main...HEAD` (packages/shared `playback.ts`, `index.ts`; apps/server
  `config.ts`, `app.ts`, `index.ts`, `library/repository.ts`, `playback/*`; apps/web `api.ts`,
  `catalog/DetailDialog.tsx`, `playback/*`, styles; docs: spec, ADR-0006, sequence 02, state 05)
- Checks run: design (`architecture-guardian`) · docs (`doc-auditor`) · tests (`test-auditor`) ·
  security (read-only pass, Opus) · correctness (read-only review)
- Verdict: **ship** after the fixes in 91f4197 · Must 4 (all fixed) · Should 12 (10 fixed, 2 deferred) · Nice 6

## Pre-merge gate (head SHA 91f4197, branch — to re-run on the merged SHA)

| Step | Result |
|---|---|
| 1 Tests | ✅ 16 shared · ✅ 241 server · ✅ 66 web (no E2E suite yet) |
| 2 Coverage | server 98.27 % stmts / 95.25 % branches / 95.18 % funcs / 98.42 % lines · web 100 / 92.98 / 100 / 100 (floor 80) · docs ≈ 97 % exported symbols (doc-auditor estimate, floor 90) |
| 3 SonarQube | ✅ PASSED (first run FAILED on 1 new issue S6819 `role="status"` → `<output>`, fixed) |
| 4 Secrets | ✅ gitleaks clean (`origin/main..HEAD`) · only `.env.example` tracked (placeholders) · diff read: nothing sensitive |
| 5 QA pass | ✅ full, HEVC + AC-3 MKV through real FFmpeg, Chromium and Firefox, console clean, close and 60 s idle cleanup verified; concurrency smoke after the fixes (3 parallel POSTs → 1×201, 2×503, one FFmpeg) · screenshots: `qa/2026-10-23-issue-8-hls-transcode/` |

- Gate (pre-push): **GREEN — push authorised**. Merge gate re-runs on the merged SHA.

## Pre-merge gate (merged SHA c67eef6 — main had not moved, so the branch head is the merge result)

| Step | Result |
|---|---|
| 1 Tests | ✅ 16 shared · ✅ 245 server · ✅ 67 web |
| 2 Coverage | server 98.18 % stmts / 95.35 % branches / 95.28 % funcs / 98.32 % lines · web 100 / 92.98 / 100 / 100 |
| 3 SonarQube | ✅ PASSED |
| 4 Secrets | ✅ gitleaks clean (`origin/main..HEAD`) · only `.env.example` tracked · no tool text left in docs |
| 5 QA pass | ✅ Chromium, real HEVC MKV through FFmpeg after the Codex fixes (1280×720, plays, console clean), close removes the session dir and FFmpeg · `qa/2026-10-23-issue-8-hls-transcode/chromium-3-premerge-c67eef6.png` · Firefox not re-run (unchanged web path, passed on 91f4197) |

- Codex review on PR #29: 9 findings over 5 rounds, 8 fixed (cover-art probe + re-probe migration, integer session limit, even scaled height, owned-dir cleanup, leaked doc text, native HLS errors), 1 deferred to #28 (check/open race on the input path); CodeQL `js/missing-rate-limiting` on the `onReady` hook dismissed as a false positive (owner decision).
- Gate: **GREEN — merge authorised on owner approval**.

## 🔴 Must Have

- `apps/server/src/playback/session-manager.ts:67` `[security|correctness|design|docs]` · limit check before two awaits: N concurrent POSTs started N FFmpeg (CPU/disk exhaustion), and the comment claimed the opposite · **fixed**: `starting` counter reserved before the first await, test with two parallel opens.
- `apps/server/src/index.ts` `[security|design|correctness]` · start-up `rm -rf $TRANSCODE_DIR`: a misset value (`data`, `MEDIA_ROOT`) wiped the database or the media · **fixed**: `SessionManager.clean()` removes only `session-*` children (`onReady` hook), tested.
- `apps/web/src/playback/PlayerDialog.tsx:136` `[sonar]` · S6819 `role="status"` · **fixed**: `<output>`.
- `docs/architecture/specs/hls-transcode.md` §4, 4a · ADR-0006 Decision `[docs]` · default dir, fatal-error behaviour and `PlayerDialog` props were stale · **fixed** (spec, ADR, sequence 02 guard placement and `not_playable` leg).

## 🟡 Should Have

- `session-manager.ts` `[correctness|design]` · `close()` could reject (ENOTEMPTY after SIGKILL) into an unhandled rejection from the idle timer · **fixed**: `remove()` retries and logs, never rejects.
- `session-manager.ts` `[design]` · every normal close logged `ffmpeg failed` · **fixed**: only a crash still in the map is logged.
- `session-manager.ts` `[design|tests]` · an FFmpeg crash after ready held the slot · **fixed**: the session closes, tested.
- `session-manager.ts` `[correctness]` · a synchronous spawn throw leaked the temp dir · **fixed**, tested.
- `PlayerDialog.tsx` `[correctness|docs]` · spec 4a not implemented: a fatal hls.js error kept the session · **fixed**: `fail` ends the session; a failed hls.js chunk load also fails cleanly.
- `PlayerDialog.tsx` `[design]` · POST fired during render · **fixed**: ref-guarded start inside the effect; `key={playing.id}` in `DetailDialog`.
- `apps/web/src/api.ts` `[correctness|design]` · non-JSON 2xx left the player on "Preparing…" · **fixed**: mapped to `failed`, tested.
- `api.ts` / `packages/shared/src/playback.ts` `[docs|design]` · dead `mediaFileUrl`, unused `PlaybackSessionBody` · **fixed**: removed / used with `satisfies`.
- `ffmpeg-args.ts` `[design]` · cover art could be mapped as the video · **fixed**: `-map 0:V:0`.
- `session-manager.test.ts`, `session-routes.test.ts` `[tests]` · real-timer idle test and fire-and-forget writes · **fixed**: fake timers, `writeFileSync`; heartbeat-stops-on-unmount and busy-message tests added.
- `apps/server/src/index.ts` `[security]` · FFmpeg children orphaned on a server crash (SIGKILL/OOM) · **deferred** to a follow-up issue (Docker `init`, crash handler).
- `apps/server/src/library/ffprobe.ts` `[design]` · attached pictures probed as video streams (copy decision may consider the cover) · **deferred**, same follow-up.

## 🔵 Nice to Have

- `session-routes.ts:10` `[design]` · `confinedPath` imported from the direct-play routes file; move next to `path-guard` when a third user appears.
- `session-manager.ts` `[design]` · recursive poll could be a `while` loop — kept: SonarQube S9382 forbids `await` in a loop here (project gotcha).
- `app.ts` `[design]` · `transcodeMaxSessions ?? 1` duplicates the config default.
- `ffmpeg-args.ts` `[security]` · no free-disk check before a session (bounded by film size × sessions).
- `ffmpeg-args.ts:11` `[design]` · 10-bit H.264 is copied and may not decode (same limit as #23).
- `ffmpeg-args.test.ts` `[tests]` · `args ?? []` hides a null result; segment-name table overlaps `filePath` tests.

## ⚪ Disagree / Intentional

- `PlayerDialog.tsx` `[correctness]` · no stop on unmount without `close` · intentional: StrictMode would end a live session; the 60 s watchdog covers it (ADR-0006 consequences).
- `transcoder.ts` two seams (`Spawn`, `Transcoder`) · each is its module's test boundary (ADR-0006).
- Direct play also posts `/playback/sessions` · ADR-0006 §6-A, single authority.

## Per-dimension summary

- Design: proportionate structure; the race, the destructive start-up wipe and the render side effect were the real issues, all fixed.
- Docs: ≈ 97 % presence; freshness drift in spec/ADR/sequence fixed.
- Tests: healthy pyramid, boundaries-only doubles; flakiness and two missing invariants fixed.
- Security: no injection or traversal; limit bypass and `rm -rf` of a configurable dir fixed; orphan FFmpeg on crash deferred.
- Correctness: unhandled rejections and spec 4a gap fixed.
