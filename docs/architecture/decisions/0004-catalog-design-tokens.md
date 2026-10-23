# ADR-0004 — Catalog: "velvet house" palette, self-hosted Inter type scale, pure view-state

- Status: proposed (owner validation of the weights requested on PR #5)
- Date: 2026-10-23
- Deciders: owner
- Related: UC3 / UC4 ([spec](../specs/catalog-grid.md)), ADR-0001, ADR-0003, issue #5

## Context

#5 is the first real screen. The owner asked (2026-10-23) for a dark "cinema room"
ambiance, a touch of red recalling cinema seats, a modern minimalist UI, and controls whose
options depend on the previous choice. Four choices were open. Contrast ratios below are
**verified** (WCAG 2.x formula, computed on 2026-10-23); other scores are estimates.

## 1. Colour palette

- **A — Velvet house**: warm near-black `#0e0b0d` background (a hint of red in the black,
  like a dimmed theatre), surfaces `#1b1518`, warm off-white text `#f4efe9`, muted
  `#a39a94`; seat-velvet red `#b3122e` as *fill* (buttons, active tab) and a lighter
  `#e8495c` for red text, focus rings and the rating star.
- **B — Streaming black**: pure black `#000000`, brand red `#e50914`.
- **C — Midnight**: blue-black `#0b1020`, crimson `#c81d3a`.

| Criterion                                     | Weight | A                                                         | B                                                     | C                                               |
| --------------------------------------------- | -----: | --------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Fit with the brief (cinema room, seat red)    |     30 | 5 — velvet red on a warm dark house                       | 3 — reads "Netflix", not "theatre"                    | 3 — night sky rather than auditorium            |
| Accessibility (verified contrast)             |     25 | 5 — text 17.1:1, muted 7.1:1, white on red 6.9:1, focus 5.2:1 | 3 — white on red 4.8:1, red on black 4.4:1 (< 4.5 for text) | 4 — white on red 5.7:1, red on bg 3.3:1 (focus only) |
| Poster readability (neutral around artwork)   |     20 | 4 — slight warmth, posters stay true                      | 5 — neutral                                           | 3 — blue cast shifts warm posters               |
| Distinctiveness (own identity)                |     15 | 5                                                         | 1 — copy of a competitor                              | 4                                               |
| Eye comfort in a dark room                    |     10 | 5 — no pure black/white halation                          | 3 — pure black + bright red                           | 4                                               |
| **Total / 500**                               |    100 | **480**                                                   | 310                                                   | 350                                             |

Points: A = 150+125+80+75+50 = 480 · B = 90+75+100+15+30 = 310 · C = 90+100+60+60+40 = 350.
Sensitivity: doubling "poster readability" to 40 (others renormalised) keeps A
first (A ≈ 4.6/5 vs B ≈ 3.7/5). **A.**

## 2. Typography

- **A** — system font stack (`system-ui`, …), modular scale ×1.25 from 1 rem
  (0.8 / 1 / 1.25 / 1.563 / 1.953 / 2.441 rem), display weight 700, tight tracking on titles.
- **B** — self-hosted webfont (e.g. Inter, ~100 KB woff2) with the same scale.
- **C** — Google Fonts link.

| Criterion                                  | Weight | A                                 | B                                  | C                                        |
| ------------------------------------------ | -----: | --------------------------------- | ---------------------------------- | ---------------------------------------- |
| Privacy (no third-party egress, data-flow 06) |  35 | 5                                 | 5                                  | 0 — every viewer's IP goes to Google     |
| KISS / weight                              |     25 | 5 — zero bytes                    | 3 — font files, licence, preload   | 4                                        |
| Visual consistency across devices          |     20 | 3 — varies by OS                  | 5                                  | 5                                        |
| Modern minimalist look                     |     20 | 4 — native UI fonts are modern    | 5                                  | 5                                        |
| **Total / 500**                            |    100 | 440                               | **450**                            | 300                                      |

Points: A = 175+125+60+80 = 440 · B = 175+75+100+100 = 450 · C = 0+100+100+100 = 300.
Sensitivity: the lead is thin (10 points); with KISS at 35 and look at 10, A would win
(455 vs 430). On the stated weights **B**: Inter (variable, OFL licence) bundled by Vite
from `@fontsource-variable/inter` and served by our own server, with the system stack as
fallback in `--font-body`.

## 3. Spacing and shape

4 px base, scale `--space-1…8` = 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px; radii 4 / 8 /
12 px; poster ratio 2:3, backdrop 16:9; one shadow for raised surfaces; motion 150 ms /
250 ms ease-out, disabled under `prefers-reduced-motion`. No alternative scored: a 4 px
grid is the industry default and nothing in the brief argues otherwise.

## 4. View state for the dynamic controls

- **A** — pure reducer (`useReducer`) over `{ type, view, genre }` encoding the state
  diagram 05; options are derived from the data.
- **B** — URL query (`?type=films&view=genre&genre=28`) with a router.
- **C** — global store (Zustand / Redux).

| Criterion                         | Weight | A                                     | B                                             | C                         |
| --------------------------------- | -----: | ------------------------------------- | --------------------------------------------- | ------------------------- |
| KISS / no new dependency          |     35 | 5                                     | 3 — router dependency or hand-rolled history  | 2                         |
| Testability (pure transitions)    |     30 | 5 — reducer unit-tested               | 4                                             | 4                         |
| Deep links / back button          |     20 | 2                                     | 5                                             | 2                         |
| Fits the state diagram            |     15 | 5                                     | 4                                             | 4                         |
| **Total / 500**                   |    100 | **440**                               | 385                                           | 290                       |

Points: A = 175+150+40+75 = 440 · B = 105+120+100+60 = 385 · C = 70+120+40+60 = 290.
**A**; deep links come with a router when #7 adds a player route (the reducer then
reads its initial state from the URL).

## Consequences

- `styles/tokens.css` is rewritten with the A palette; components use tokens only.
- Inter variable is self-hosted through `@fontsource-variable/inter`: one woff2 per
  subset, fetched by the browser only for the `unicode-range` it needs (latin: 48 KB).
- Web tests: Vitest + Testing Library on jsdom for components, a Playwright smoke on the
  grid with the API mocked at the network layer.
