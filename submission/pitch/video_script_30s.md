# Demo video · 30 seconds · round 3 script (English)

Portal rule: ≤ 30 s, English (or Spanish with English subtitles). Guideline followed: 0:00 team · 0:02 challenge · 0:05 name + tagline · 0:10 how it works + NASA data · 0:20 future.
Format: 1920×1080, H.264, no voice-over (on-screen text carries the story; optional soft music, royalty-free, credited in references).
Source of every shot: the real app (headless capture, `e2e/record-demo.mjs`) and the team phone for the WhatsApp shot. No AI-generated footage.
On-screen text: Figtree 600, white on a dark glass pill, bottom third; key numbers in Fraunces, maize yellow (#e0a526).

| Time | Shot (picture) | On-screen text (EN) | Source |
|---|---|---|---|
| 0:00–0:02 | Title card on dark earth | **Field Shift** · NASA Space Apps 2026 · Guatemala | ffmpeg title card |
| 0:02–0:07 | Landing (EN): type "Jocotán", tap the place, tap **See my season** (×1.5) | Type your place. Two taps. The guide starts on its own. | `/?lang=en`, one take |
| 0:07–0:11 | Globe → camera centred on the pin → municipality outline on SRTM + Sentinel-2 → diorama rises (×3.5) | Your place, from NASA satellites: anywhere on Earth | `/sandbox?…&auto=1`, same take |
| 0:11–0:19 | Guided season (×6): forecast rain, maize grows, midsummer drought, harvest; narration subtitles and the confidence badge on screen | Next 16 days: forecast. Then the past year that best matches the seasonal outlook. → 40 % chance of a crop-loss season · happened in 8 of 24 years · medium confidence | same take (scenario `pronostico`, run of 14 Nov 2026) |
| 0:19–0:21.5 | Split screen S0 \| S2, same day, both animated | Same rain: what you do today vs. maize + velvet bean cover | `/sandbox?…&comparar=1` |
| 0:21.5–0:24 | Season result card (both numbers, "lost season" mark, confidence line) | One clear result at the end of the season | same take |
| 0:24–0:26.5 | Technical report page 1 (EN) | Every number in a technical report (web + PDF), with sources and limits | same take → `/informe?…` |
| 0:26.5–0:28.5 | Web phone simulator: **TEST ALERT** answered with today's real forecast | Real WhatsApp bot · 2026 replay: 5 of 6 dry-spell alerts confirmed | live bot on `/`, EN |
| 0:28.5–0:30 | Closing card | Field Shift · Free · WhatsApp + web · anywhere on Earth · NASA POWER · GPM IMERG · MODIS · SRTM · NEX-GDDP-CMIP6 | ffmpeg title card |

Rendered file: `submission/video/fieldshift-demo-30s.mp4` (1920×1080, 30 fps, H.264 NVENC, 29.97 s, captions burned at the top; no audio track). Captions also in `submission/video/subtitles_en.srt`.
Re-record: `cd e2e && node record-flujo.mjs http://127.0.0.1:8200 "Jocotán" <dir>` (one continuous headless take + `marcas.json`), then the ffmpeg cut described in `docs/video.md` (section "Video de la entrega").
⟦Team name⟧ is not on the title card yet: add it when the team confirms the name.

## Captions file (SRT, same lines)
```
1
00:00:02,000 --> 00:00:07,000
Type your place. Two taps. The guide starts on its own.

2
00:00:07,000 --> 00:00:11,000
Your place, from NASA satellites: anywhere on Earth

3
00:00:11,000 --> 00:00:15,000
Next 16 days: forecast. Then the past year that best matches the seasonal outlook.

4
00:00:15,000 --> 00:00:19,000
40 % chance of a crop-loss season · happened in 8 of 24 years · medium confidence

5
00:00:19,000 --> 00:00:21,500
Same rain: what you do today vs. maize + velvet bean cover

6
00:00:21,500 --> 00:00:24,000
One clear result at the end of the season

7
00:00:24,000 --> 00:00:26,500
Every number in a technical report (web + PDF), with sources and limits

8
00:00:26,500 --> 00:00:28,500
Real WhatsApp bot · 2026 replay: 5 of 6 dry-spell alerts confirmed
```
