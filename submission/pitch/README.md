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

## Images to replace with the final captures (round 3)
Current images are from `estado/muestras` (round 2–3 work in progress). Overwrite the file in `img/` with the same name and aspect, then re-export.

| Slide | `img/` file | Replace with |
|---|---|---|
| 1 | `diorama.jpg` | final diorama frame (ranch with more houses, realistic trees, no terrain peaks): escena3d3 / vuelo3 |
| 2 | `map-guatemala.jpg` | OK as is (English risk map) |
| 3 | `landing-form.jpg` | final English landing (round 3) |
| 3 | `terrain.jpg` | flight frame with the pin centred (vuelo3) |
| 3 | `storm.jpg` | final guided-video frame (storm or dry spell) |
| 3, 7 | `report.jpg` | **English** technical report page 1 (`/informe?…&lang=en`) |
| 3 | `nairobi.jpg` | global example in English |
| 4 | `field-rain.jpg` | sandbox frame showing the confidence badge (vuelo3) |
| 5 | `compare.jpg` | final S0 \| S2 split screen in English |
| 6 | `timemachine.jpg` | OK as is |
| 6 | `wa-bubble.jpg` | photo/screen recording of the real WhatsApp chat on the team phone (phone number masked) |

## Before submitting
- Fill every `⟦…⟧` (`grep -rn "⟦" submission/`): team name, WhatsApp number, final forecast numbers.
- Slides use the forecast run of 14 Nov 2026 (47 %, 8 of 24, 17–32 qq/mz). If the final build shows different numbers, update slide 4 and the video text together.
- Upload `slides.pdf` as a public link (Drive/GitHub) only if the team picks slides instead of the video for field 3 (the portal accepts one or the other).
