# Demo video · 30 seconds · round 3 script (English)

Portal rule: ≤ 30 s, English (or Spanish with English subtitles). Guideline followed: 0:00 team · 0:02 challenge · 0:05 name + tagline · 0:10 how it works + NASA data · 0:20 future.
Format: 1920×1080, H.264, no voice-over (on-screen text carries the story; optional soft music, royalty-free, credited in references).
Source of every shot: the real app (headless capture, `e2e/record-demo.mjs`) and the team phone for the WhatsApp shot. No AI-generated footage.
On-screen text: Figtree 600, white on a dark glass pill, bottom third; key numbers in Fraunces, maize yellow (#e0a526).

| Time | Shot (picture) | On-screen text (EN) | Source |
|---|---|---|---|
| 0:00–0:02 | Black → woven stripe slides in; team logo | **⟦Team name⟧ · NASA Space Apps 2026 · Guatemala** | title card |
| 0:02–0:05 | Risk map of Guatemala, slow push-in to the Dry Corridor (red municipalities) | **One long dry spell can wipe out a rain-fed season.** | `/sandbox` intro, map shot |
| 0:05–0:08 | Landing: a finger types "Jocotán", taps *Milpa* → *No irrigation* → **See my season** | **Field Shift** · *See your next season before you plant it.* | `/` landing (EN), 2 taps |
| 0:08–0:11 | Camera flies to the pin, centred, down to the real SRTM + Sentinel-2 hillside; the diorama rises (ranch, trees) | **Your place, from NASA satellites: anywhere on Earth** | `/sandbox?…&auto=1` flight |
| 0:11–0:16 | Season timelapse: forecast rain, then the canícula dries the soil, a storm flashes, maize grows | **Next 16 days: forecast. Then the past year that best matches the seasonal outlook.** | sandbox, scenario `pronostico` |
| 0:16–0:19 | Confidence badge fades in over the field | **47 % chance of a lost season · happened in 8 of 24 years · confidence: medium** ⟦CHECK final run⟧ | sandbox confidence badge |
| 0:19–0:22 | Split screen S0 \| S2: bare soil vs mucuna cover, same day | **Same rain. Cover crop: erosion 61 → 4 t/ha/yr** | sandbox compare |
| 0:22–0:26 | Phone (real WhatsApp): dry-spell alert lands; cut to the technical report PDF page | **Real WhatsApp alerts · 2026 test: 5 of 6 dry-spell alerts confirmed** | team phone + `/informe` |
| 0:26–0:30 | Closing card over the diorama: logo, URL, WhatsApp QR | **Free · on WhatsApp · NASA POWER · IMERG · MODIS · CMIP6 · SRTM** · ⟦URL⟧ | title card |

## Shot list for the recording
1. `/?lang=en` landing, viewport 1920×1080, type "Jocotán" with 60 ms/char, 2 taps, click. Hide the cursor.
2. Let `auto=1` run the guide; take 0:08–0:22 from that single take (no cuts inside the flight).
3. Phone: screen-record the real chat after sending **PRUEBA ALERTA** (portrait; place it on the right third, landscape canvas, blurred field behind). Mask the phone number.
4. `/informe?…` page 1, 1-second slow scroll.
5. Assemble with FFmpeg (`h264_nvenc`), burn the captions, export `submission/video/fieldshift-demo-30s.mp4`; update `subtitles_en.srt` with the same lines.

## Captions file (SRT, same lines)
```
1
00:00:00,000 --> 00:00:02,000
⟦Team name⟧ · NASA Space Apps 2026 · Guatemala

2
00:00:02,000 --> 00:00:05,000
One long dry spell can wipe out a rain-fed season.

3
00:00:05,000 --> 00:00:08,000
Field Shift · See your next season before you plant it.

4
00:00:08,000 --> 00:00:11,000
Your place, from NASA satellites: anywhere on Earth

5
00:00:11,000 --> 00:00:16,000
Next 16 days: forecast. Then the past year that best matches the seasonal outlook.

6
00:00:16,000 --> 00:00:19,000
47 % chance of a lost season · happened in 8 of 24 years · confidence: medium

7
00:00:19,000 --> 00:00:22,000
Same rain. Cover crop: erosion 61 → 4 t/ha/yr

8
00:00:22,000 --> 00:00:26,000
Real WhatsApp alerts · 2026 test: 5 of 6 dry-spell alerts confirmed

9
00:00:26,000 --> 00:00:30,000
Free · on WhatsApp · NASA POWER · IMERG · MODIS · CMIP6 · SRTM
```
