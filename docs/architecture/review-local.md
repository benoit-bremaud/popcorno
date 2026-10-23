# Local review — popcorno (issue #7 direct play)

- Date: 2026-10-23
- Commit reviewed: 6fa92d9 (feat) · fixes: the `fix(playback)` commit that follows it
- Scope: branch diff `origin/main...HEAD` (packages/shared `playback.ts`, apps/server
  `src/playback/*`, `library/path-guard.ts`, `library/repository.ts`, apps/web `catalog/DetailDialog.tsx`,
  `playback/*`, styles, docs)
- Checks run: design + docs (`architecture-guardian`) · tests (`test-auditor`) · security +
  correctness (Opus read-only pass)
- Verdict at review time: **ship after the gate fix** · Must 2 (SonarQube gate) · Should 11 · Nice 9
- Resolution: both Musts and every Should applied; Nice items filed as a follow-up issue;
  Disagree items kept as designed.

## Pre-merge gate (head SHA of the fix commit, before the PR)

| Step        | Result                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Tests     | ✅ 16 shared + 191 server + 42 web (Vitest) · Playwright play + seek in Chromium and Firefox (QA script)                                                                                                                         |
| 2 Coverage  | tests ✅ server 98.22 % stmts / 94.34 % branches / 94 % funcs / 98.5 % lines · web 100 / 91.2 / 100 / 100 · shared 100 % (floor 80) · docs ✅ every new export documented (design/docs audit)                                     |
| 3 SonarQube | ✅ PASSED. The first scan on 6fa92d9 FAILED on 2 new issues (S4084 `<video>` without `<track>`, S7765 `.some()` → `.includes()`), both fixed, none waived                                                                      |
| 4 Secrets   | ✅ gitleaks clean (`origin/main..HEAD`) · only `.env.example` tracked · diff read: nothing sensitive                                                                                                                             |
| 5 QA pass   | ✅ full: generated MP4/H.264+AAC and AVI/MPEG-4 under a scratch `MEDIA_ROOT`, scan, curl 206 / 416, Play → `<video>` plays, seek to 20–25 s (Chromium, Firefox), Escape closes the player and returns focus to Play, AVI shows the note, console clean, network 206 only: `qa/2026-10-23-issue-7-direct-play/` |

- Gate: **GREEN** — the merge waits on the PR review (CI, Codex) and the owner's approval.

## 🔴 Must Have

- `apps/web/src/playback/PlayerDialog.tsx:39` `[correctness]` · SonarQube S4084, `<video>` without `<track>` · fixed: an empty captions track (subtitles are not served yet).
- `packages/shared/src/playback.ts:57` `[correctness]` · SonarQube S7765 · fixed: `codecs.includes(undefined)`.

## 🟡 Should Have

- `apps/server/src/playback/routes.ts` `[security]` · TOCTOU between `realpath` / `stat` and a second open by path · fixed: open the checked real path once with `O_NOFOLLOW`, `fstat` and stream from the handle.
- `apps/server/src/playback/range.ts` `[correctness|design]` · a malformed or multi-range header answered 416, and `null` / `undefined` carried two meanings · fixed: tagged `RangeRequest`; malformed or multi-range → 200 whole (RFC 9110 §14.2), 416 only past the end.
- `apps/server/src/playback/routes.ts:49` `[design]` · "at or under root" repeated in scanner, library routes, playback (Rule of Three) · fixed: `isAtOrUnderRoot` in `path-guard.ts`.
- `apps/server/src/playback/routes.ts` `[correctness]` · the 416 response carried `Content-Type: video/mp4` · fixed: set only on 200 / 206.
- `docs/architecture/specs/direct-play.md` `[docs]` · codec table not per container, `createReadStream(start, end)` wording · fixed.
- `apps/server/src/playback/routes.test.ts` `[tests]` · added the malformed / multi-range route cases, empty 416 body, HEAD, root = `MEDIA_ROOT`, directory at the path, the `media_not_found` code on escapes.
- `apps/web/src/catalog/DetailDialog.test.tsx` `[tests]` · added the player's own close (Escape) leaving the detail open and an unplayable episode without a button.
- `packages/shared/src/playback.test.ts` `[tests]` · hardcoded expected MIME (no tautology), uppercase codec and dotted names.

## 🔵 Nice to Have (filed as a follow-up issue)

- `apps/server/src/playback/routes.ts` `[correctness]` · weak `ETag` + `If-Range` so a file replaced mid-viewing is not spliced.
- `apps/server/src/playback/routes.ts` `[correctness]` · HEAD opens a handle and a stream it never reads.
- `packages/shared/src/playback.ts` `[correctness]` · profile / bit depth not probed: 10-bit H.264 is offered and fails in `<video>`; first audio stream only.
- `apps/server/src/playback/routes.ts` `[security]` · `O_NOFOLLOW` covers the last path component only; a directory swapped higher up needs write access to the media tree.
- `apps/web/src/playback/PlayerDialog.tsx` `[correctness]` · an autoplay refusal (`NotAllowedError`) shows no hint.
- `packages/shared/src/playback.ts:5` `[design]` · `PlaybackDecision.mime` unused by the web until a `<source type>` or #8 needs it.

## ⚪ Disagree / Intentional

- `apps/server/src/playback/routes.ts` `[design]` · depends on the concrete `LibraryRepository`: flat layering per CLAUDE.md, no second implementation.
- `packages/shared/src/playback.ts:1` `[design]` · type-only import of `index.ts`, which re-exports it: erased at runtime, no cycle.
- `apps/web/src/playback/can-play.test.ts` `[tests]` · one-line wrapper test kept as the only link to the real DOM seam.
- `apps/server/src/playback/routes.test.ts` `[tests]` · real file system + in-memory DB on purpose: a mocked fs would hide the symlink escape.

## Per-dimension summary

- Design: flat, no over-engineering; one Rule-of-Three duplication fixed · Docs: every export documented, spec mismatches fixed · Tests: healthy pyramid, no domain mocks, gaps filled · Security: uuid-only input, guard re-run per request, TOCTOU narrowed to the handle · Correctness: Range semantics aligned with RFC 9110, nested dialog close guarded.
