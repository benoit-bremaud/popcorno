# QA pass — #9 resume playback, PR #32 (2026-10-24)

| Level | Head SHA | Environment | Targets | Agent / model |
|---|---|---|---|---|
| pass | 3a9354f | local (server :3000, Vite :5173, temp SQLite, temp MEDIA_ROOT) | W + A | qa-tester · Sonnet 5.5 (product part + SEC probes scoped to the diff) |

Plan. Domains in: FON (UC6 / UC7 journeys, failure branches), DAT (progress and sessions contracts,
validation, persistence), UI/A11Y on the detail dialog and the Next button, ROB (early close, session
reaping), SEC probes touching the new routes. Out: PERF, privacy consent, MOB, responsive/theme
(no layout primitive changed beyond two buttons; dark theme only, 1440 × 900). Media: four generated
150 s files (H.264/AAC MP4 direct film, H.264/AC-3 MKV forcing HLS, two MP4 episodes). Browsers:
Chromium (Playwright) and Firefox 1543 (`executablePath`). No TMDB key, so episode titles are the
series title.

## Results

| ID | Check | Verdict | Evidence |
|---|---|---|---|
| FON-01 / S1 | Direct film: play, seek to 60 s, wait, close → "Resume from 1:13" (Chromium) / "1:12" (Firefox) + "Start over"; reload → still offered; Resume → `startSec` = saved, `currentTime` 73.17 / 72.20 | PASS ×2 | `*-1-direct-1…4-*.png` |
| FON-01 / S2 | HLS (MKV): play ≥ 15 s, pause (saves 15), close → `DELETE` 204, "Resume from 0:15"; Resume → POST `startSec` 15 → 201 `offsetSec` 15; plays; later position 20 = 15 + 5 s; second `DELETE` 204; no FFmpeg process, transcode dir empty afterwards | PASS ×2 | `*-2-hls-1…3-*.png` |
| FON-01 / S3 | Start over → POST `startSec` 0, plays from 0.5 s; a close at 4 s overwrites the old position (< 10 s → plain "Play") | PASS ×2 | `*-1-direct-5-start-over.png` |
| FON-01 / S4 | Episode E01: no Next at start; seek to 93 % → "Next episode: Show ▶" (settled: opacity 1, 216 × 40 px); click → saves 139, POST for E02, E02 plays from 0; `GET /progress` E01 `finished: true`; E02 ended / last episode → nothing offered; Escape closes only the player | PASS ×2 | `*-4-episode-1…4-*.png`, `chromium-4-episode-2b-next-settled.png` |
| FON-02 | Close before `loadedmetadata` (media file delayed 2.5 s) → no PUT, saved 73 s kept (spec 5a) | PASS (Chromium) | `chromium-5-early-close-detail.png` |
| FON-09 | Save cadence: first PUT 10.0 s after play start (12.1 s / 12.2 s), then pause, then `keepalive: true` PUT on close (fetch wrapper) | PASS ×2 | network log |
| DAT-01 | `PUT /media/:id/progress` → 204; `GET /progress` → 200 `{mediaId, positionSec, durationSec, finished, updatedAt}`; sessions answer carries `startSec` + `offsetSec` (direct 0, HLS = startSec) | PASS | curl |
| DAT-03 | PUT body `-1`, `1.5`, `604801`, `"5"`, `{}`, non-JSON → 400 `invalid_request`; non-uuid id → 400; series id → 404; unknown uuid → 404; `604800` on a 150 s file → 204 and clamped to 150 (finished); unknown field `profileId` ignored (204, no effect). Sessions: `startSec` −1 / 1.5 / 604801 → 400; `startSec` 150 on a 150 s file → 200 `startSec: 0` (4b); HLS `startSec` 90 → `offsetSec` 90 | PASS | curl |
| DAT-02 | Positions survive page reload (S1) and are read back from SQLite | PASS | S1 |
| UI-02 | Console: no error or warning from our code in both browsers (only Vite debug and React DevTools info; Firefox adds React perf `timeStamp` lines) | PASS | console capture |
| A11Y | Detail actions tree: `button "▶ Resume from 1:13"`, `button "Start over"`; focus returns to the Resume/Play trigger after the player closes; Next button is a real `<button>` | PASS, see Nice 1–3 | aria snapshot |
| ROB | Idle: nothing left after runs (no FFmpeg, empty transcode dir); 503 `transcode_busy` while a session holds the single slot | PASS | `pgrep`, `ls` |
| SEC-01 | Security headers on `/progress` and `/playback/sessions` | FAIL, known | #31 (not re-filed) |
| SEC-02 | Cookies | N/A (none set) | |
| SEC-03 | `Origin: https://evil.test` on POST sessions → no `Access-Control-Allow-Origin` | PASS | curl |
| SEC-04 | XSS | N/A: the diff renders no user text (titles, `Resume from m:ss` only) | |
| SEC-05 | Authz | N/A (no accounts before #18; one `default` profile by design, spec R2) | |
| SEC-06 / 08 | Bad bodies, bad ids, unknown route: clean `invalid_request` / Fastify 404, no stack, path or SQL | PASS | curl |
| SEC-07 | Rate limit | NOT TESTED (none specified for the new routes; saves are idempotent upserts) | |
| SEC-09 / 10 | Bundle / third parties | NOT TESTED / PASS: only `localhost` hosts seen in the network list (dev build; bundle scan not part of this diff) | |
| FON-12 | Regression | N/A, first report on this feature | |
| ROB-11 | Firmware safety | N/A | |

## Not covered

Responsive widths, light theme, Safari/WebKit, prod-build bundle scan (SEC-09), keyboard-only walk of
the whole flow, HLS with the real `-ss` keyframe drift (4a: copy mode, the test file is re-encoded),
the 60 s idle reap after a tab kill (covered by #8's report). Screenshots use a 320 × 180 test
pattern: the proof is in the numbers above.

## Findings

No 🔴 Must, no 🟡 Should.

1. 🔵 Nice, in scope of the PR (not filed): episode ▶ buttons get identical accessible names
   ("Play Show" ×2, A11Y) when episodes have no title of their own (library without TMDB data). The
   visible number sits in a sibling span. Suggest `Play ${title}, episode ${n}` in the `aria-label`
   (`DetailDialog.tsx` episode button) and the same for "Resume … from".
2. 🔵 Nice, in scope (not filed): "Next episode" appears without any announcement (no live region,
   focus stays on "Close player", WCAG 4.1.3). A screen-reader user in the player will not learn it
   exists. A wrapper with `role="status"` (rendered always, content swapped) would do.
3. 🔵 Nice, in scope (not filed): replaying a finished episode and leaving after < 1 s saves 0 and
   resets its `finished` flag (observed: E01 went 139 → 0). It follows spec 2a and R4, so it is a
   product decision rather than a defect; worth one line in the spec if intended.
4. 🔵 Nice, covered by #31: personal API answers (`GET /progress`) carry no `Cache-Control`; no CSP,
   `nosniff` or `Referrer-Policy` on any API route. Not re-filed.

Verdict: the feature behaves as the spec says in both engines, including the failure branches
(early close, past-the-end start, rejected bodies). Dev-build noise (Vite HMR, React DevTools,
Firefox `timeStamp` lines) is not a finding.

## Delta vs previous report

First report for #9. Previous playback report: `2026-10-23-issue-8-hls-transcode/README.md`; its checks
(HLS plays, `DELETE` on close, no FFmpeg left) were re-observed and still hold.

## Screenshots (`docs/architecture/qa/2026-10-24-resume-playback/`)

Per browser (`chromium-`, `firefox-`, prefix `2026-10-24-`): `1-direct-1-detail-fresh`,
`1-direct-2-playing-60s`, `1-direct-3-detail-resume-offered`, `1-direct-4-resumed`,
`1-direct-5-start-over`, `2-hls-1-paused`, `2-hls-2-detail-resume`, `2-hls-3-resumed`,
`4-episode-1-detail`, `4-episode-2-next-offered`, `4-episode-3-e02-playing`, `4-episode-4-after`.
Chromium only: `5-early-close-detail`, `4-episode-2b-next-settled` (the `2-next-offered` frame
caught the button mid-fade).
