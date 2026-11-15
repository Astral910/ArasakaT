# Project page texts · round 4 (English, ready to paste)

These replace or extend the fields in `submission/0*.md` with the round-3 and round-4 features: **global**, **forecast with measured confidence**, **technical report**, **real WhatsApp**, and (round 4) **the exact plot drawn on the map**, **a realistic diorama built in the visitor's browser** and **a short report with exportable charts**.
Markers `⟦…⟧` must be filled before pressing Submit (`grep -rn "⟦" submission/`).
Every number below comes from the engine output or the backtest already in the repo (sources in brackets at the end of this file). Before submitting, re-check the ones tagged ⟦CHECK⟧ against the final build.

---

## 1 · Project Name
**Field Shift** ⟦TBD: the team confirms the final name; the web app already uses "Field Shift"⟧

Tagline: *See your next season before you plant it.*

---

## 2 · High-Level Project Summary
(portal field; ~180 words)

A smallholder in Guatemala's Dry Corridor plants maize and beans on rain alone, and one long mid-summer dry spell (*canícula*) can wipe out the season. Field Shift turns NASA Earth data into a decision the farmer can see. They drop a pin anywhere on Earth and answer two taps (crop, size, irrigation). A guided 3D video then plays their coming season on their own hillside, day by day. Every frame comes from a deterministic engine: the 16-day ECMWF/GFS forecast, followed by the real NASA POWER weather of the past year that best matches the ECMWF SEAS5 seasonal outlook and the forecast El Niño, run through an FAO-56 water balance. The video says which scenario it shows, how likely it is, in how many comparable past years it happened, and how well the method did against documented droughts. The farmer gets three strategies (today's milpa, a bean relay, a cover crop) compared on risk, harvest and soil, a printable technical report, and dry-spell and heavy-rain alerts on a WhatsApp number that works today. In the real 2026 season, 5 of 6 dry-spell alerts in Jocotán were confirmed, with no false alarms.

---

## 3 · Detailed Project Description

### What it does
Field Shift is a free planning and early-warning tool for rain-fed smallholders, built first for the *milpa* (maize + beans) of Guatemala's Dry Corridor and now usable at any coordinate on Earth. It answers three questions a farmer asks before and during the season:
1. **What is the coming season likely to look like here?** A guided 3D video of their own season, driven by a forecast with a measured confidence.
2. **What should I plant to lose less and protect my soil?** Three strategies compared, one of them what they do today, following the challenge's five-point sheet.
3. **When do I need to act?** Dry-spell, heavy-rain, planting-window and frost alerts on WhatsApp, all season long.

### How it works
**1. Two taps, or the exact plot.** On the landing page the farmer searches a town, village, *colonia*, residential or condominium anywhere in the world (OpenStreetMap Photon and Nominatim, Esri World Geocoder, Open-Meteo), for example "Condominio Las Margaritas" → Zona 10, Guatemala City. Two taps are enough. They can also mark **the exact plot**: a point, a circle with a draggable radius, or a free polygon of up to 200 corners clicked on high-resolution imagery. The area is computed from the shape (in *cuerdas*, *manzanas* and hectares). If the shape falls on a river or lake (OpenStreetMap water), the page warns and does not let them continue. Everything else has sensible defaults. The guided video starts on its own.

**2. The flight and the diorama, built on the visitor's device.** The camera flies from the map straight to the plot and down to the real terrain (SRTM relief, Esri World Imagery, with the whole route preloaded so no blank tiles appear). The real outline of the plot is drawn on the ground. Then the plot rises as a diorama **to real scale and with its real shape**, and everything is rendered in the visitor's browser (WebGL), with a loading screen that names each stage: relief, ground, city, houses, vegetation. Quality adapts to the device. On a laptop GPU the first load takes 7–15 s, then 50–60 fps.
- **The ground is the real land cover**: ESA WorldCover / Esri–Impact Observatory 10 m land cover (Sentinel-2), refined with the satellite colour and the slope, becomes 3D materials: grass with blades that move in the wind, sand with ripples and dunes, rock with strata, tilled soil with clods, wetland, leaf litter. Rivers and lakes from OpenStreetMap are real water with banks.
- **The neighbourhood is modelled**: building footprints from Overture Maps (OpenStreetMap, Google and Microsoft Open Buildings), with heights from OSM or estimated, and the roof type read from the satellite image (clay tile, concrete slab, metal sheet). Buildings that fall inside the plot are removed; streets follow the terrain. Footprints are real; facades and estimated heights are illustrative.
- **Rural plots get a farm** chosen from the biome (milpa, coffee under shade, cattle, vegetables with a tunnel, dry farm with a well), with adobe or block houses, animals and paths.
- **Nothing is placed on water.** No plot, tree, house or fence ends up in a river or lake. If the plot itself is on water, the diorama says so and offers to pick another place.

**3. The season, from the forecast.** The engine (`POST /api/simulate`, scenario `pronostico`, the default) builds the coming season:
- **days 1–16**: the daily forecast from the best available model (ECMWF IFS / NOAA GFS via Open-Meteo);
- **after day 16**: the real NASA POWER daily weather of an **analogue year**, the past year (2001–2025) whose rain and temperature anomalies best match the **ECMWF SEAS5** seasonal forecast (51 members, 6 months) and whose El Niño state matches the forecast Niño-3.4 anomaly, anchored to NOAA's latest ONI.

That weather goes through the same deterministic engine as the rest of the tool (FAO-56 water balance, FAO-33 yield response, RUSLE soil). The video shows rain, soil water, crop stage and stress, dry spells, storms above the local 95th percentile, heat, frost, planting and harvest. It shows only what the engine computed for that day.

**4. Confidence, measured and said out loud.** Each run carries a confidence block that the video and the report display:
- the **scenario** and its **probability**, for example (Jocotán, forecast run of 14 Nov 2026): *"For the usual milpa, expect a lost season: 40 % probability; it happened in 8 of 24 comparable years. Likely harvest 17–32 qq/mz. Confidence: medium."* ⟦CHECK: final run numbers; the text is generated per run⟧
- the **track record** of the method: *flagged 5 of 8 documented droughts (2001–2025) in Jocotán · Brier score 0.154 for the AI model vs 0.161 for plain statistics*. Outside Guatemala it says *"no local validation"* and caps the confidence;
- the **measured skill of the forecast itself**, per municipality: a leave-one-out hindcast over 2001–2025 (342 municipalities × 25 seasons, year-block bootstrap). In Chiquimula, Jocotán's department, the analogue method picked the right rain tercile in **65 % of seasons** (90 % CI 52–78 %; chance is 33 %); Jalapa 52 %, Jutiapa 47 %. **Nationwide it is 40 % (CI 32–49 %), not distinguishable from chance**, and the raw loss probabilities were over-confident, so they are **shrunk 50 % toward climatology** and the badge says, for each place, whether the method beats chance there;
- a transparent **confidence rule**: points for scenario probability, local validation, forecast-driven season and a narrow harvest range → high / medium / low. Climate projections for 2040 are never rated above medium.

**5. Three strategies.** For each plan the engine compares:
- **S0 · Milpa as today** (the farmer's current practice);
- **S1 · Bean (or sorghum) relay in Postrera**, residue kept on the ground;
- **S2 · Milpa with a mucuna/canavalia cover crop**.

For each one it reports seasons lost out of 10 (P10–P90), water deficit, yield range in quintals per manzana, organic-matter trend over 5 years, erosion, bare-soil days, and the **five-point sheet**: why it is suggested, evidence, benefits, missing information, and risks that need local review. The farmer's priorities and limits (food, water, soil or income; labour; livestock; seed access) re-rank the options. In Jocotán (all seasons 2001–2025): S0 loses 3.3 of 10 seasons with 61 t/ha/yr of erosion; S1 loses 1.1 with 12 t/ha/yr; S2 loses 2.6 with 4 t/ha/yr, and bare soil drops from 260 to 115 days a year. A 2026 ↔ 2040 switch recomputes the plan with NEX-GDDP-CMIP6 deltas.

**6. The report: short, visual, exportable.** At the end of the video, one tap opens `/informe` (web, English/Spanish) or downloads it as a PDF (`/api/informe.pdf`). The cover fits one screen: a one-sentence verdict, four big numbers (risk out of 10, harvest range for the coming season, confidence, soil organic matter in 5 years) and a satellite map with the real shape of the plot. Then six sections, each with **one chart** and two or three lines: the coming season (weekly rain and soil water against the FAO-56 stress line), the three strategies as P10–P50–P90 ranges, dry-month risk, soil in 5 years, the effect of irrigation, and 2040. Every chart can be downloaded as **PNG, SVG or CSV** with the raw data. A **"What to get"** section turns the result into practical items: short-cycle seed, mucuna/canavalia, water harvesting sized to the plot (litres per week), drip irrigation, mulch, a rain gauge, a hermetic silo. Each says why (with the engine's numbers), when, and where to ask (MAGA, ICTA, farm stores). No brands, and no prices without a verified source. The full technical annex (confidence, five-point sheets, 25 seasons, methodology, validation, sources, limitations) is folded at the end and printed in the PDF. Every number on the page is checked against the engine output by an automated script.

**7. Alerts on real WhatsApp.** The same bot works on the web phone simulator and on a real WhatsApp number linked as a device through **Evolution API** (open source, self-hosted; the team scans a QR code once on `/admin/whatsapp`) ⟦CHECK: number + QR/join instructions on the site⟧. A farmer sends a location pin, answers buttons, and gets the plan card, the season video (MP4 with ambient sound and narration) and the technical report as a PDF document in the chat. Voice notes work both ways: a voice note is transcribed on the team's GPU (faster-whisper) and answered like text, and typing AUDIOS makes the bot also reply with short synthetic voice notes (TEXTO turns it off). They can opt in to alerts: an engine runs every day at 06:00 local time and sends, idempotently, a warning when the 16-day forecast shows a dry spell (≥ 7 dry days with each model's threshold calibrated against NASA POWER 2001–2025), heavy rain (above the local 95th percentile), the rain onset or a false onset, the seasonal El Niño outlook, or frost. Every alert says *what is coming · when · how sure we are · what to do · check with your extension agent*. Sending **PRUEBA ALERTA** (or **TEST ALERT**) triggers one at once, so a judge can try it. Commands: MENU, CAMBIAR, EN, AYUDA, VIDEO, AUDIOS/TEXTO, BAJA/STOP.

**8. The 2026 time machine (validation of the alerts).** We replayed the alert engine on every day of the real 2026 season (195 days) using only the forecasts that existed that morning (Open-Meteo Historical Forecast API), and compared each alert with NASA POWER observed rain. Jocotán: **5 of 6 dry-spell alerts confirmed, 0 false alarms**, rain onset called 4 days ahead, best lead time **7 days** (17 Oct 2026, before an 8-day dry spell; median 2 days). Heavy rain is harder: **3 of 14** alerts confirmed (21 % precision vs 6 % by chance), though both multi-day storm episodes were flagged. We publish the misses.

**9. For extension workers.** A 3D risk map of Guatemala's 342 municipalities (2026 or 2040), with an "X-ray" slider over MODIS NDVI and GPM IMERG rain, ranking, CSV export, and an alerts panel with subscriber counts per municipality (no phone numbers) and the weekly "How is your milpa?" answers.

### Global by design
Any latitude and longitude work. Outside the 342 precomputed Guatemalan municipalities the engine fetches NASA POWER daily data (and SoilGrids soil texture) on demand, caches it on disk, and builds the season with generic rainy-season calendars. The 3D scene reuses terrain and vegetation templates by biome, so every place gets a credible diorama without a custom model. ⟦CHECK: final list of tested places outside Guatemala, e.g. Nairobi⟧ Confidence is honest about it: no local drought record means no local validation, and the badge says so.

### Benefits
- **For the farmer**: knows before planting how risky the coming season is and which option loses less, sees it as a short video instead of a dashboard, and gets warned days before a dry spell, on the app they already use. Free.
- **For the soil**: the comparison makes bare soil and erosion visible (in Jocotán, 61 → 4 t/ha/yr with a cover crop), turning soil health into a planting decision.
- **For extension agents and cooperatives**: a printable report per farm, a risk map by municipality, and field reports that arrive by themselves every week.
- **For science and institutions**: every number has a source, a range and a track record; the method is open and reproducible.

### Scientific basis and honesty
- **Deterministic engine** in Go: FAO-56 Penman-Monteith ET₀ and daily root-zone water balance (soil water from SoilGrids texture via Saxton & Rawls), FAO-33 yield response, rain-onset rule adapted from Sivakumar (1988), Monte Carlo over 25 real seasons (2001–2025) split by El Niño state (NOAA ONI), NEX-GDDP-CMIP6 deltas for 2040, RUSLE cover factors for erosion. Compiled to WebAssembly too, so the static site recalculates in the browser.
- **The AI does not invent numbers.** The engine computes; a small logistic-regression model is compared with plain statistics (leave-one-year-out Brier 0.154 vs 0.161) and both are shown. An LLM is optional and off by default.
- **Ranges, not promises**: P10–P90 everywhere; results are for the municipality or climate zone (NASA POWER cells are ~50 km), never "your exact plot". NASA POWER rain changes source around 2000, so we only use 2001 onwards.
- **Validation is separate for each part**: the engine against documented droughts (5 of 8 in Jocotán, 4 false alarms); the seasonal forecast with a 25-year hindcast (beats chance in the Dry Corridor, not nationwide, and we say so); the alerts against the real 2026 season.
- **Supports, never replaces** the farmer and their extension agent; every plan and alert ends by saying so.

### Why it matters
3.4 million people in Guatemala (19 % of the population) were in acute food insecurity (IPC Phase 3+) in May–August 2025, and 3.2 million are projected for July–September 2026 (IPC/SESAN), a year in which El Niño lengthened the dry spells in the Dry Corridor. Hundreds of millions of smallholders elsewhere farm on rain alone with the same blind spot. A tool that runs on WhatsApp, works anywhere, and says how sure it is can reach them where no farm app does.

### What works today and next steps
- **Today**: public web (English/Spanish, mobile-first, static fallback); two-tap landing with worldwide neighbourhood search and exact plot drawing (point, circle, polygon) → guided 3D season on a realistic diorama of the real plot and its neighbourhood, rendered in the visitor's browser, with a confidence badge; short report with exportable charts and practical recommendations (web + PDF); WhatsApp bot on a real linked number and on the web simulator, with daily alerts; 2026 time machine; risk map of 342 municipalities; the engine running on the server and in the browser (WebAssembly).
- **Next**: an official WhatsApp Business number (Meta Cloud API, approved Utility templates) to replace the demo-linked number; a pilot with MAGA extension agents in Chiquimula; recalibration with the weekly field reports; voice notes and Mayan languages (Ch'orti', K'iche', Q'eqchi') with native speakers; local drought records outside Guatemala so confidence can be validated there too.

---

## 4 · Use of Artificial Intelligence
**The idea is ours.** It comes from our team member's proposal (milpa rotation planning over WhatsApp for the Dry Corridor), written before any AI tool was used.

**AI coding assistant.** We used Claude Code (Anthropic) to speed up writing and testing the Go backend, the Vue web app, the 3D scene, tests, deployment files and the English drafts of these texts. The team defined the scope, the data choices and the scientific method (FAO-56, FAO-33, Monte Carlo, analogue forecast, CMIP6 deltas) and reviewed the output. Generated code is declared here, as the rules require.

**Voice and sound.** The guided video's narration and the bot's optional voice replies use **synthetic speech (Microsoft Edge neural TTS, es-GT / en-US voices)** built from fixed sentence templates and the engine's numbers; farmers' voice notes are transcribed locally with **faster-whisper** (open speech-recognition model). The ambient sound is synthesized in the browser (Web Audio), not recorded or generated by AI. ⟦CHECK: keep only what ships in the final build⟧

**Illustrations.** The SVG illustrations and icons drawn for the web (landing, empty states, plan card decorations) were written as SVG code by the AI coding assistant; the 3D scene (terrain, trees, houses, weather) is procedural code, not generated imagery. **No AI image or video generator was used**, so no image needs a watermark, and no NASA logo appears anywhere in AI-assisted content. Map imagery is real data (SRTM, Sentinel-2, MODIS, IMERG). ⟦CHECK with the team: if anyone adds an AI-generated image before submitting, list it here and watermark it⟧

**AI in the product.**
1. **AI vs statistics**: a small, transparent logistic-regression model trained on NASA POWER features (825 seasons = 33 zones × 25 years) is compared with plain Monte Carlo frequencies, with cross-validated Brier error shown to the user (0.154 vs 0.161). This is the comparison the challenge asks for.
2. **Optional LLM** (off by default): only to understand free-text WhatsApp messages and phrase replies using the numbers computed by the engine. No number, threshold or recommendation comes from an LLM; the bot works end to end without one.

---

## 5 · NASA Data
(unchanged from `04_nasa_data.md`, plus the global use)

| Dataset | Use |
|---|---|
| **NASA POWER** Daily API (community AG) | Core of the engine: FAO-56 ET₀ and water balance, rain onset and canícula, Monte Carlo of 25 seasons, alert thresholds, the analogue-year weather replayed in the forecast scenario, and the observed side of the 2026 backtest. **Fetched on demand for any coordinate on Earth** (disk cache). |
| **GPM IMERG** (via NASA GIBS) | "X-ray" rain layer on the risk map (e.g. 2023 vs 2026). POWER rain itself blends IMERG. |
| **MODIS MOD13Q1 NDVI** (via NASA GIBS) | "X-ray" vegetation layer; independent cross-check of drought years. |
| **NEX-GDDP-CMIP6** | Monthly deltas 2038–2042 vs 2010–2014, SSP2-4.5 and SSP5-8.5, three models: the 2040 plan. |
| **SRTM** (AWS Terrain Tiles) | 3D relief of the map and the diorama, slope for erosion, temperature correction by elevation. |
| **NASA GIBS** | Satellite layers in the browser without downloading rasters. |

## 6 · Space Agency Partner Data & Other References
- **ESA Copernicus Sentinel-2** cloudless mosaic (EOX): terrain imagery under the 3D relief.
- **ECMWF** (IFS 16-day forecast and **SEAS5** seasonal forecast) and **NOAA GFS**, via the Open-Meteo Forecast, Seasonal and Historical Forecast APIs: the forecast scenario and the 2026 backtest.
- **NOAA CPC Oceanic Niño Index (ONI)**: El Niño conditioning and the anchor of the forecast Niño-3.4 anomaly.
- **ISRIC SoilGrids 2.0**: soil texture and organic matter.
- **FAO-56, FAO-33**, Saxton & Rawls (2006), Sivakumar (1988), RUSLE: methods.
- **IPC / SESAN Guatemala**, FEWS NET, MAGA: food-security figures and documented drought years.
- **geoBoundaries** ADM2: municipal boundaries.
- Full list with links, libraries and licences: `submission/05_partner_data_and_references.md`.

## 7 · Tools
Go (net/http, FAO-56 engine also compiled to WebAssembly, PNG plan cards with fogleman/gg, SQLite via modernc.org/sqlite, PDF report via chromedp + headless Chromium), WhatsApp linked-device channels (Evolution API v2 and whatsmeow) plus Meta Cloud API and Twilio adapters, Vue 3 + Vite + TypeScript, Pinia, Vue Router, Three.js (3D season; procedural ground materials, Web Workers, IndexedDB cache), MapLibre GL (maps), Overture Maps PMTiles and OpenStreetMap (Overpass, OpenFreeMap vector tiles) for buildings, streets and water, ESA WorldCover and Esri–Impact Observatory land cover, GSAP, Lucide icons, Vitest, Playwright, headless Chromium + FFmpeg (NVENC) for the server-rendered season video, edge-tts (narration) and faster-whisper on CUDA (voice notes).

---

### Sources of the numbers used above
- Forecast example, confidence rule and sources: `contracts/fixtures/sim_jocotan_pronostico.json` (motor3, commit 01b340e, forecast run of 14 Nov 2026).
- S0/S1/S2 for Jocotán, bare-soil days, erosion: technical report sample `estado/muestras/informe/jocotan-es.png` (live engine).
- Forecast hindcast (65 % Chiquimula, 40 % nationwide): `docs/validacion_pronostico.md` (agent validacion, worktree spaceapps-wt/validacion).
- Drought validation (5 of 8), AI vs statistics, 2026 backtest: `submission/03_detailed_description.md` and the *How do we know?* page. The Brier pair is 0.155 / 0.160 in the older text and 0.154 / 0.161 in the current engine output; use the engine's value everywhere ⟦CHECK⟧.
