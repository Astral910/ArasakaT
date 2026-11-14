# Demo video · 30 seconds · script with English subtitles

File: `video/fieldshift-demo-30s.mp4` · 1920×1080, H.264 (NVENC), 29.9 s, no audio. Upload as an unlisted YouTube video or a public Drive link (portal field 3).
Source: the app's `/demo` route (automatic tour), recorded headless from the real app with real engine and backtest numbers. The English captions are part of the picture; `video/subtitles_en.srt` has the same lines for YouTube closed captions.
Optional: replace 0–9 s with the phone recording of the real WhatsApp chat (team phone on Meta's test number).

| Time | Picture | Caption (EN) |
|---|---|---|
| 0:00–0:04 | WhatsApp chat on the phone: "Hi", location pin of Jocotán, crop list | A farmer in Jocotán shares a location on WhatsApp |
| 0:04–0:07.5 | Plan card arrives in the chat with the 12-month ring and the three options | The plan card arrives in seconds |
| 0:07.5–0:11.5 | 3D sandbox: high shot over Guatemala's risk map → flight down to Jocotán's real terrain (SRTM + Sentinel-2) → the field rises as a diorama | NASA terrain and climate data for the area |
| 0:11.5–0:17.4 | Season timelapse driven by the engine: dry spell, storms (rain, wet soil), crop growing to harvest, HUD with soil water and crop health | Real NASA weather, day by day: dry spells and storms |
| 0:17.4–0:20.3 | Split screen S0 \| S2: bare soil vs mulch/cover crop, same day, engine numbers on each side | Same season: today's milpa vs a cover crop |
| 0:20.3–0:25 | Dry-spell alert lands on the phone; 2026 time machine with real rain and the real dry spell shaded | In 2026 it warned up to 7 days ahead of a real dry spell |
| 0:25–0:29.9 | Closing card | Free · on WhatsApp · for 3.4 million people facing hunger (IPC/SESAN 2025) |

The sandbox shot (7.5–20.3 s) is `web/public/static/demo/sandbox.mp4`: rendered by the app's own server (`GET /api/sim/video.mp4`, headless Chromium + NVENC, frame by frame from the FAO-56 engine, Jocotán, milpa + velvet bean, typical year = real 2013 weather) sped up ×1.9, plus 3 s of the live split-screen comparison.

Portal guideline (0:00 team · 0:02 challenge · 0:05 name · 0:10 how + NASA data · 0:20 future): the header shows "Field Shift · NASA Space Apps 2026 · Guatemala". When the team picks the final name ⟦TBD⟧, re-record with `cd e2e && node record-demo.mjs "http://127.0.0.1:8200/demo?autostart=1&rec=1" 29.9 --skip=1.4`.
