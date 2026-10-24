# QA — #8 HLS transcode (2026-10-23)

Real FFmpeg 7 on a generated 40 s file: 1280×720 HEVC (`hvc1`) + AC-3 in MKV
(`ffmpeg -f lavfi testsrc2 … -c:v libx265 -c:a ac3`). Server on :3000, Vite on :5173,
Playwright (Chromium, Firefox 1543 via `executablePath`), 1440×900, dark.

| Check | Chromium | Firefox |
| ----- | -------- | ------- |
| Play shown for the MKV (no "Not playable") | ✅ `*-1-detail.png` | ✅ |
| `POST /playback/sessions` → 201 hls, FFmpeg libx264 + aac | ✅ | ✅ |
| Plays through hls.js (blob source, 1280×720, t > 3 s) | ✅ 5.9 s to 3 s | ✅ 6.4 s |
| Console errors | none | none |
| Close → `DELETE`, session dir removed, no FFmpeg left | ✅ | ✅ |
| 60 s idle (no heartbeat, curl only) → FFmpeg killed, dir removed | ✅ | — |

Found and fixed during this pass: native-HLS claim of Chromium (hls.js now first) and the
StrictMode double start racing the single transcode slot (ADR-0006 consequences).
