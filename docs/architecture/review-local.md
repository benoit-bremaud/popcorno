# Local review — popcorno (issue #4 TMDB metadata)

- Date: 2026-10-23
- Commit reviewed: fabd3bc (feat) · fixes: 121efd6 (review findings) + 681ae7f (lint ignore for QA scripts)
- Scope: branch diff `main...HEAD` (apps/server `src/metadata/*`, `src/library/*`, `src/http.ts`, `src/app.ts`, `src/config.ts`, Drizzle migration 0001, packages/shared, docs)
- Checks run: design (`architecture-guardian`) · docs (`doc-auditor`) · tests (`test-auditor`) · security (`security-policy` pass) · correctness (`code-review` flow)
- Verdict at review time: **fix Must Have first** · Must 7 · Should 20 · Nice 11
- Resolution: every Must and Should applied; Nice items filed as a follow-up issue; Disagree items kept as designed. No owner decision was needed (no trade-off among the Musts).

## Pre-merge gate (head SHA 681ae7f, before the PR)

| Step        | Result |
| ----------- | ------ |
| 1 Tests     | ✅ 146 unit/integration (Vitest, 12 files) · no E2E suite yet (Playwright planned) |
| 2 Coverage  | tests ✅ 98.25 % stmts / 93.45 % branches / 93.89 % funcs / 98.62 % lines (floor 80) · docs ✅ 100 % (85/85 exports, floor 90) |
| 3 SonarQube | ✅ PASSED (new code: 0 issue, 0 hotspot, 0 % duplication, 95.6 % coverage). The scan on fabd3bc FAILED on 2 smells (S4624 nested template literal, S1874 deprecated `z.string().url()`); a first fix introduced 2 × S9382 (`await` in a loop) — all cleared, none waived |
| 4 Secrets   | ✅ gitleaks clean (`main..HEAD`) · only `.env.example` tracked · diff read: nothing sensitive (fake key `qa-fake-key` only in the QA double) |
| 5 QA pass   | ✅ full with a **mocked TMDB** (no real key available): built server on loopback + `ffprobe`, scan with include, media list, artwork route (200 / 400 / 404), enrich plain / refresh / 400 / 404, no-key mode, 0 warn / 0 error in the server log: `qa/2026-10-23-issue-4-tmdb-metadata/` |

- Gate: **GREEN — merge authorised** once the PR review is handled (CI, Copilot / Codex, owner approval). Caveat recorded: the QA used a TMDB double; a replay against the real API with a key is filed as a Nice follow-up.

## 🔴 Must Have

- `apps/server/src/metadata/artwork-cache.ts:37` `[sonar]` · S4624 nested template literal · split into `digest + extname(path)` ✅
- `apps/server/src/metadata/tmdb-client.ts:158` `[sonar]` · S1874 deprecated `z.string().url()` · `z.url()` ✅
- `docs/architecture/specs/tmdb-metadata.md:80`, ADR-0003 § 4, sequence 02, data-flow 06 `[docs]` · digest formula documented as `sha256(path)`, code hashes `size + path` · docs aligned ✅
- ADR-0003 Consequences, sequence 02 notes `[docs]` · "client strips the key from any error" — the key never enters an error (header only); claim replaced by what the error carries ✅
- spec § Technology, ADR-0003 § 4, sequence 02 `[docs]` · configuration "read once per run" at run start — it is read lazily on the first image download and cached for the client's life · aligned ✅
- `docs/architecture/specs/tmdb-metadata.md:48` `[docs]` · success guarantee "every pending row has `metadataFetchedAt`" false for `failed` rows · qualified ✅
- `packages/shared/src/index.ts:153`, README, spec `[docs]` · `ScanReport.metadata` null also when the include threw · documented ✅

## 🟡 Should Have

- `apps/server/src/metadata/tmdb-client.ts` `[security]` · no body size cap on image downloads · `IMAGE_MAX_BYTES` 10 MB checked on `Content-Length` and on the bytes read (413) ✅
- `apps/server/src/metadata/tmdb-client.ts` `[security]` · announced `secure_base_url` trusted · pinned to `https://image.tmdb.org`, `redirect: 'error'` on image fetches ✅
- `apps/server/src/metadata/tmdb-client.ts` `[security]` · unbounded provider strings · `.max()` 10 000 on overviews, 500 on names ✅
- `apps/server/src/library/repository.ts:117` `[correctness]` · a rescanned changed file reverts the TMDB title and is never looked up again · `metadataFetchedAt: null` on conflict update ✅
- `apps/server/src/metadata/repository.ts:32` `[correctness]` · episodes added after the series was matched never enriched · a series with a pending episode is pending (`EXISTS` sub-query) ✅
- `apps/server/src/metadata/service.ts:154` `[correctness]` · spec 8b "fields kept" violated on refresh (`markUnmatched` cleared them) · `markLookedUp` writes only `metadataFetchedAt` ✅
- `apps/server/src/metadata/service.ts`, `artwork-cache.ts` `[correctness]` · failures swallowed without a trace · `EnrichLogger` injected (`app.log`), `onError` on the cache ✅
- `apps/server/src/metadata/service.ts:57,124` `[design][correctness]` · `reduce/.then` chains (global TS rule) vs Sonar S9382 on `await` in a loop · recursive `sequentially()` helper, neither ✅
- `apps/server/src/metadata/tmdb-client.ts:276` `[correctness]` · a late failure reset a newer healthy configuration promise · reset only when it is still ours ✅
- `apps/server/src/metadata/tmdb-client.ts:193` `[correctness]` · 429 / error bodies never cancelled · `body.cancel()` before retry / throw ✅
- `apps/server/src/metadata/service.ts:93` `[correctness]` · `parseInt` accepts `12abc` as tag 12 · `^\d{1,12}$` ✅
- `apps/server/src/metadata/artwork-cache.ts:44` `[correctness]` · fixed `.part` name races on the same still · random suffix ✅
- `apps/server/src/metadata/artwork-cache.ts:26` `[design][tests]` · dead `directory` getter + its test · removed ✅
- `apps/server/src/library/scanner.ts:7` `[design]` · `ScanOutcome` declared between imports · moved below ✅
- `apps/server/src/metadata/repository.ts:48` `[design]` · `countLookedUp` selects all rows · `count()` ✅
- `apps/server/src/metadata/service.ts:135` `[design]` · `Awaited<ReturnType<…>>` · `readonly TmdbEpisode[]` ✅
- `apps/server/src/metadata/service.test.ts:310` `[tests]` · in-flight test depended on timing · deferred promise + `vi.waitFor` ✅
- `apps/server/src/metadata/service.test.ts:274` `[tests]` · `setTimeout(…,1)` and two behaviours in one test · microtask yield, split ✅
- `apps/server/src/metadata/routes.test.ts`, `service.test.ts` `[tests]` · missing: include throw path, `unknown` rows, rescan reset, late episode, 8b keep, bad tag, size cap, base pin, redirect, string bounds, concurrent cache · added (135 → 146 tests) ✅
- spec, sequence 02, `tmdb-client.ts:57` `[docs]` · "six operations/endpoints", wrong participant names and signatures, 8a wording, images not retried on 429, 15 s / 10 s WHY, synthetic statuses, `saveMetadata` replaces title, `toEpisodeInput` tmdbId, Cache-Control WHY, `/enrich` synchronous · all aligned ✅

## 🔵 Nice to Have

Filed as issue #15 (chore(metadata): nice-to-have follow-ups from the #4 local review):
`TMDB_LANGUAGE` validation · distinguish `metadata: null` causes · keep the previous match on a failed refresh · shared `isTmdbImagePath()` · HTTP-date `Retry-After` · split the large series tests, dateless-candidate ordering · replay the QA against the real API with a key.

## ⚪ Disagree / Intentional

- `apps/server/src/metadata/tmdb-client.ts` `[design]` · interface + factory for a single implementation · the seam is the test boundary (fake client in every service / route test) and the ADR-0003 second-provider note; precedent ADR-0001 flat layering.
- `apps/server/src/metadata/artwork-cache.ts` `[design]` · the cache depends on `TmdbClient` · keeps the client the single HTTP egress (component diagram 03).
- `apps/server/src/metadata/matcher.ts` `[design]` · separate pure module · fixtures-only tests, no I/O (spec § Related information).
- `apps/server/src/http.ts` `[design]` · helpers extracted from the library routes · two route modules share them; three lines each.
- Two repositories (`library/repository.ts`, `metadata/repository.ts`) `[design]` · one per domain, same table · the metadata one owns the metadata columns only.
- `apps/server/src/app.ts` `[design]` · `null` as the feature flag for `tmdb` / `enrich` · mirrors `TMDB_API_KEY` unset; no second mechanism.

## Per-dimension summary

- Design: no Must; dead getter, misplaced type, `reduce` chains, `count()` — all applied · Docs: five stale claims (digest, key stripping, lazy configuration, fetchedAt guarantee, null meaning) fixed, diagram re-drawn · Tests: deterministic concurrency tests, 11 new cases, 146 green · Security: size cap, host pin, no redirect, bounded strings; key never in URL / log (QA grep) · Correctness: two real bugs (rescan revert, late episodes) fixed plus 8b, logging, tag parsing, body cancel, `.part` race.
