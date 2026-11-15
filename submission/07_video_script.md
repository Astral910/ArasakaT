# Demo video · 30 seconds · script with English subtitles

File: `video/fieldshift-demo-30s.mp4` · 1920×1080, H.264 (NVENC), 29.97 s, no audio. Upload as an unlisted YouTube video or a public Drive link (portal field 3).
Source: one continuous headless take of the real app (round-3 flow: place → 2 taps → centred flight → guided season → result card → technical report), recorded with `e2e/record-flujo.mjs` against the real server, plus the live S0 | S2 split screen and the web phone simulator answering TEST ALERT. Real engine numbers (forecast run of 14 Nov 2026). The English captions are burned at the top; `video/subtitles_en.srt` has the same lines for YouTube closed captions.

| Time | Picture | Caption (EN) |
|---|---|---|
| 0:00–0:02 | Title card | Field Shift · NASA Space Apps 2026 · Guatemala |
| 0:02–0:07 | Landing: type "Jocotán", tap it, tap *See my season* | Type your place. Two taps. The guide starts on its own. |
| 0:07–0:11 | Globe → camera centred on the pin → SRTM + Sentinel-2 terrain → diorama with the ranch | Your place, from NASA satellites: anywhere on Earth |
| 0:11–0:19 | Guided season driven by the engine (forecast, drought, harvest), narration subtitles, confidence badge | Next 16 days: forecast. Then the past year that best matches the seasonal outlook. / 40 % chance of a crop-loss season · happened in 8 of 24 years · medium confidence |
| 0:19–0:21.5 | Split screen S0 \| S2, same day | Same rain: what you do today vs. maize + velvet bean cover |
| 0:21.5–0:24 | Season result card | One clear result at the end of the season |
| 0:24–0:26.5 | Technical report page 1 | Every number in a technical report (web + PDF), with sources and limits |
| 0:26.5–0:28.5 | Phone simulator: TEST ALERT with today's forecast | Real WhatsApp bot · 2026 replay: 5 of 6 dry-spell alerts confirmed |
| 0:28.5–0:30 | Closing card | Free · WhatsApp + web · anywhere on Earth · NASA POWER · GPM IMERG · MODIS · SRTM · NEX-GDDP-CMIP6 |

The `/demo` route keeps its own automatic tour (clip `web/public/static/demo/sandbox.mp4`, regenerated 14 Nov with the final scene).
Team name ⟦TBD⟧: when the team picks it, add it to the title card and re-cut (recipe in `pitch/video_script_30s.md`).
