# Demo video · 30 s (round 4)

| File | Format |
|---|---|
| `fieldshift-demo-30s.mp4` | 1920×1080, 60 fps, H.264 High (NVENC) + AAC, 29.6 s, ~37 MB. Upload this one (portal field 3). |
| `fieldshift-demo-30s-vertical.mp4` | 1080×1920 (9:16) for social media, same cut and sound. |
| `subtitles_en.srt` | Same lines as the on-screen text, for YouTube closed captions. |

Every shot is the real app, recorded headless (Chromium, GPU) from the round-4 build: no AI-generated footage. The numbers on screen come from the engine on the day of recording (14 Nov 2026, scenario `pronostico`).
Sound: an ambient bed synthesised with FFmpeg (low chord, wind, rain during the storm shot). No third-party music or samples.

| Time | Shot | On-screen text |
|---|---|---|
| 0:00 | Globe spinning (landing) | Every season is a bet on the rain. · NASA Space Apps 2026 · Guatemala |
| 0:02 | Globe, darkened | **Field Shift** · See your next season before you plant it. |
| 0:04 | Search "Condominio Las Margaritas" → camera flies to the estate | Search any neighbourhood on Earth |
| 0:07 | Polygon of the plot drawn on the satellite map | Draw your exact plot · Point, circle or polygon |
| 0:09 | Flight: globe → Guatemala risk map → Jocotán outline → terrain → diorama, centred on the point | From satellites to your field · Forecast + 25 years of NASA climate data |
| 0:11 | The estate diorama: polygon plot, real soil, neighbouring houses in 3D | Your real plot, in 3D |
| 0:14 | Guided season, Jocotán: storm (62 mm in one day) | Storms... |
| 0:16 | Midsummer drought, low camera over the maize | ...and the midsummer drought |
| 0:18 | Confidence badge (47 % likely, 8 of 24 years, medium) | It tells you how sure it is |
| 0:20 | Season result card (19.4 vs 20.2 qq/mz) | One clear answer |
| 0:22 | Technical report (web) | Every number in a technical report |
| 0:25 | Web WhatsApp simulator (live bot): TEST ALERT answered with today's forecast | Real alerts on WhatsApp |
| 0:27 | Closing card: logo, name, tagline, NASA datasets | Free · WhatsApp + web · anywhere on Earth |

Re-make: server on 127.0.0.1:8207, then `node tools/demo-video/grabar.mjs` (takes) and `node tools/demo-video/armar.mjs` (cut). Details in `tools/demo-video/README.md`.
