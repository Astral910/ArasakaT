# Pitch · round 3 (what the judges see)

| File | What it is |
|---|---|
| [portal_page.md](portal_page.md) | English texts for every portal field (name, summary, detailed description, benefits, AI use incl. illustrations, NASA data, partners, tools) with the round-3 features |
| [slides.html](slides.html) → [slides.pdf](slides.pdf) | 7 slides, 16:9 (1920×1080), the web app's visual identity. Previews in `png/` |
| [video_script_30s.md](video_script_30s.md) | 30 s video script: shots, on-screen text, SRT |
| [judge_questions.md](judge_questions.md) | 10 hard questions with short, honest answers |

## Re-export the slides
```
PLAYWRIGHT_DIR=<any repo node_modules/playwright> node submission/pitch/export.mjs
```
Headless Chromium (muted, GPU) → `slides.pdf` (7 pages) + `png/slide-N.png`. Open `slides.html?marks` to see the images to replace outlined in red.

## Images (final round-3 captures, 14 Nov 2026)
All `img/` files were replaced by the integrator with frames of the final build (EN): landing card, centred flight, diorama with the ranch, guided season with narration subtitles, confidence badge, S0 | S2 split, technical report page 1, Managua (global engine, outside Guatemala) and the web phone answering **TEST ALERT**. Still to replace by the team: `wa-bubble.jpg` with a screenshot of the **real** linked WhatsApp number (masked) once it is paired; `map-guatemala.jpg` and `timemachine.jpg` are unchanged (still valid).

## Before submitting
- Fill every `⟦…⟧` (`grep -rn "⟦" submission/`): team name, WhatsApp number, final forecast numbers.
- Slides use the forecast run of 14 Nov 2026 (47 %, 8 of 24, 17–32 qq/mz). If the final build shows different numbers, update slide 4 and the video text together.
- Upload `slides.pdf` as a public link (Drive/GitHub) only if the team picks slides instead of the video for field 3 (the portal accepts one or the other).
