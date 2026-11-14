# Demo video · 30 seconds · script with English subtitles

File: `video/fieldshift-demo-30s.mp4` · 1920×1080, H.264 (NVENC), 29.9 s, no audio. Upload as an unlisted YouTube video or a public Drive link (portal field 3).
Source: the app's `/demo` route (automatic tour), recorded headless from the real app with real engine and backtest numbers. The English captions are part of the picture; `video/subtitles_en.srt` has the same lines for YouTube closed captions.
Optional: replace 0–9 s with the phone recording of the real WhatsApp chat (team phone on Meta's test number).

| Time | Picture | Caption (EN) |
|---|---|---|
| 0:00–0:06 | WhatsApp chat on the phone: "Hi", location pin of Jocotán, crop list | A farmer in Jocotán shares a location on WhatsApp |
| 0:06–0:11 | Plan card arrives in the chat with the 12-month ring and the three options | The plan card arrives in seconds |
| 0:11–0:16 | 3D relief of Jocotán (SRTM + Sentinel-2) with the municipality outline and the planting ring | NASA terrain and climate data for the area |
| 0:16–0:21 | Three strategy cards with seasons lost out of 10 and the soil over 5 years | Three options compared, and the soil in 5 years |
| 0:21–0:25 | Dry-spell alert lands on the phone; 2026 time machine with real rain (alert on 17 Oct, dry spell from 24 Oct) | In 2026 the system would have warned 7 days before a real dry spell |
| 0:25–0:30 | Closing card | Free · on WhatsApp · for 3.4 million people facing hunger (IPC/SESAN 2025) |

Portal guideline (0:00 team · 0:02 challenge · 0:05 name · 0:10 how + NASA data · 0:20 future): the header shows "Field Shift · NASA Space Apps 2026 · Guatemala". When the team picks the final name ⟦TBD⟧, re-record with `cd e2e && node record-demo.mjs "http://127.0.0.1:8200/demo?autostart=1&rec=1" 29.9 --skip=1.4`.
