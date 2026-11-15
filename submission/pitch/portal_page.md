# Project page texts · final (English, ready to paste)

Team **ArasakaT** · device **SEED** · challenge **Field Shift** · NASA Space Apps 2026, Guatemala.
Every number below comes from the engine output or the validation already in the repo (sources at the end). The data sources listed are only the ones the code actually calls (checked with grep on 15 Nov 2026).

---

## Project Name
**SEED · from ArasakaT**

Tagline: *See your next season before you plant it.*
(The web app header still reads "Field Shift", the name of the challenge.)

---

## High-Level Summary
SEED turns NASA Earth data into a season a smallholder can see: drop a pin anywhere on Earth and watch your coming season play out in 3D on your own plot, with its odds, then follow the field every day with watering advice, alerts on WhatsApp and an assistant you can ask "will it rain on October 20?". A low-cost ESP32 soil sensor in a 3D-printed case (SEED) adds what satellites cannot see: the water in your own soil.

---

## Project Details

### What it does
SEED is a free planning and early-warning tool for rain-fed smallholders, built first for the *milpa* (maize + beans) of Guatemala's Dry Corridor, and usable at any coordinate on Earth. It answers the questions a farmer asks before and during the season:
1. **What will the coming season look like here?** A guided 3D video of their own season, driven by a forecast with a stated confidence.
2. **When should I plant, and what?** A recommended sowing date with its reasons, and three strategies (today's milpa, a bean relay, a cover crop) compared on risk, harvest and soil.
3. **What do I do today?** A page per field: water or not (in mm and litres), the week ahead, crop progress, pests to watch, and a chat assistant that remembers that field.
4. **When do I need to act?** Dry-spell, heavy-rain, planting-window and frost alerts on WhatsApp.

### How it works
**1. Where is your land?** The landing page searches any town, village or neighbourhood in the world (OpenStreetMap Photon and Nominatim, Esri World Geocoder, Open-Meteo Geocoding). The farmer can mark a point, a circle or a free polygon on high-resolution imagery; the area is computed from the shape and a plot on a river or lake is rejected (OpenStreetMap water). No account is needed to try it.

**2. The season in 3D, built in the visitor's browser.** The camera flies to the plot over real relief (SRTM via AWS Terrain Tiles, Esri World Imagery, Sentinel-2 cloudless by EOX). The plot rises as a diorama at real scale and with its real shape. The ground is the real land cover (ESA WorldCover 2021 and Esri / Impact Observatory 10 m land cover from Sentinel-2), with buildings from Overture Maps and OpenStreetMap. Rural plots get a farm chosen from the biome. The season plays day by day: rain, soil water, dry spells, storms, heat, frost, sowing and harvest. A small bar at the bottom shows the date, sowing and harvest, **growth in %** and the days left to harvest, and a confidence badge (high / medium / low; the detail goes to the report). Layers show temperature (MODIS LST reference), soil moisture, stress, erosion and greenness (Sentinel-2 NDVI from Element 84 Earth Search when a clear scene exists; otherwise marked "estimated"). At the end, without an account, the button reads **"Create your account to save your video and report"**.

**3. The engine.** A deterministic engine in Go (also compiled to WebAssembly for the static site):
- days 1–16: the daily forecast of ECMWF IFS / NOAA GFS (Open-Meteo Forecast, Ensemble and Single-runs APIs);
- after day 16: the real **NASA POWER** daily weather of the past year (2001–2025) that best matches the **ECMWF SEAS5** seasonal forecast (Open-Meteo Seasonal API) and the El Niño state (NOAA CPC ONI);
- FAO-56 Penman-Monteith ET₀ and root-zone water balance, FAO-33 yield response, RUSLE cover factors, Monte Carlo over 25 real seasons, NEX-GDDP-CMIP6 deltas for 2040;
- a recommended sowing date (rain onset, false starts, dry spell at flowering, frost, harvest by growing degree days), with reasons and risk by date.

**4. Accounts and "My fields".** Sign in with email or phone; the demo account (button on the sign-in page) holds three fields: Jocotán (milpa), a home garden in Guatemala City and a plot in Punjab, India. Each field page shows, in this order: **Today** (water or not, mm and litres, soil water, tomorrow's rain), **the next 7 days** as an icon strip, **crop growth** in % with stages, **alerts** ("around these dates fall armyworm usually appears"), and **"What do I do if…?"** questions that open on tap ("I see scraped leaves in the whorl", "plants are wilting", "it rained a lot"), by crop, each with its source (FAO, CIMMYT, CATIE, CIAT, FAO-56). A short guided tour shows where everything is the first time. The farmer reports rain, watering or a pest in one tap and the plan recalculates.

**5. One assistant per field, with its own memory.** The chat sits next to the field page (a button on phones). Each field has its own assistant that remembers its conversation, reports and changes, also from another device or WhatsApp. It answers with the field's own numbers. If you ask **"Will it rain on October 20?"** it always answers **yes or no with a probability** and says where it comes from:
- inside 16 days: the forecast's daily rain probability and amount (Open-Meteo);
- further ahead: the share of days with ≥ 1 mm on that date ±3 days in 2001–2025 from **NASA POWER** (PRECTOTCORR), in years with the same El Niño state as the current ONI, with the all-years figure next to it.
It never answers "I have no forecast". It can also open the 3D simulation for a date range, change the sowing date or record a report.

**6. The report.** Short, visual and exportable (web and PDF): a one-sentence verdict, four big numbers, the plot on a satellite map, then six charts (coming season, three strategies P10–P50–P90, dry-month risk, soil in 5 years, irrigation, 2040). Every chart downloads as PNG, SVG or CSV. A "What to get" section turns results into practical items (short-cycle seed, cover crop seed, water harvesting sized to the plot, drip, mulch, rain gauge, hermetic silo) and where to ask (MAGA, ICTA). No brands, no unverified prices.

**7. WhatsApp.** The same bot runs on a real number linked as a device through Evolution API (open source, self-hosted) and on the web phone simulator. Send a location pin, answer buttons, receive the plan card, the season video (MP4 with narration) and the report as a PDF. Voice notes are transcribed (faster-whisper) and answered. Daily alerts at 06:00: dry spell (≥ 7 dry days, thresholds calibrated against NASA POWER 2001–2025), heavy rain (above the local 95th percentile), rain onset or false onset, El Niño outlook, frost. Each alert says what is coming, when, how sure, what to do, and to check with the extension agent. **TEST ALERT** sends one at once. A phone can be linked to an account with a 6-digit code.

**8. SEED, the field sensor.** An **ESP32-S3** board and a resistive soil-moisture probe (HW-080), calibrated dry / wet in the farmer's own soil, inside a **3D-printed case** designed in OpenSCAD (hidden 5000 mAh power bank, board and probe locked in place; one plate, no supports, PLA, about 2 h 20 min). Readings stream live over USB (Web Serial) or WiFi to a web page. The server API accepts readings with a per-device token and the field page compares observed and modelled soil water. A fuller station design (soil moisture at 10 and 30 cm, soil and air temperature, tipping-bucket rain gauge, solar panel) is in the repo with firmware for ESP32-C3/S3/classic. It is a prototype, not a certified instrument.

**9. For extension workers.** A 3D risk map (342 municipalities of Guatemala, 2026 or 2040) with an "X-ray" slider over MODIS NDVI and GPM IMERG rain from NASA GIBS, ranking and CSV export, and an alerts panel.

### Confidence, measured and said out loud
- **Forecast skill**: leave-one-out hindcast over 2001–2025 (342 municipalities × 25 seasons). In Chiquimula (Jocotán's department) the analogue method picked the right rain tercile in **65 %** of seasons (90 % CI 52–78 %; chance 33 %). **Nationwide it is 40 % (CI 32–49 %), not distinguishable from chance**, so loss probabilities are shrunk 50 % toward climatology.
- **Engine vs documented droughts**: 5 of 8 flagged in Jocotán (2001–2025), 4 false alarms. A small logistic-regression model vs plain statistics: Brier 0.154 vs 0.161 (leave-one-year-out).
- **Alerts, 2026 season replayed** with the forecasts that existed each morning (Open-Meteo Historical Forecast API) vs NASA POWER observed rain, Jocotán: **5 of 6 dry-spell alerts confirmed, 0 false alarms**, best lead time 7 days; heavy rain is harder, **3 of 14** confirmed (21 % precision vs 6 % by chance). We publish the misses.
- Outside Guatemala the badge says "no local validation" and caps the confidence. Results are ranges (P10–P90) for the area (NASA POWER cells are about 50 km), never "your exact plot".

### Benefits
- **Farmers**: know before planting how risky the season is, when to plant and which option loses less; know each day whether to water and how much; get warned days before a dry spell on the app they already use. Free.
- **Soil**: the comparison makes bare soil and erosion visible (Jocotán: 61 → 4 t/ha/yr with a mucuna/canavalia cover crop; bare soil 260 → 115 days a year).
- **Extension agents and cooperatives**: a printable report per farm, a risk map by municipality, field reports from farmers.
- **Science**: every number has a source, a range and a track record; method and code are open.

### Tools
Go (net/http, SQLite via modernc.org/sqlite, chromedp for the PDF report, WebAssembly build of the engine), Vue 3 + Vite + TypeScript, Pinia, Vue Router, Three.js, MapLibre GL, GSAP, Lucide, Vitest, Playwright, headless Chromium + FFmpeg (NVENC) for the season video, Evolution API v2 / whatsmeow (WhatsApp linked device), Claude Code (assistant, see AI section), edge-tts, faster-whisper, ESP32 Arduino / PlatformIO, OpenSCAD, a desktop FDM 3D printer.

### What works today and next steps
- **Today**: public web app (English by default, ES button, mobile), accounts with saved fields and daily field page, per-field assistant, guided 3D season, report with exportable charts, WhatsApp bot with daily alerts, risk map, SEED prototype streaming live soil moisture.
- **Next**: official WhatsApp Business number (Meta Cloud API templates), pilot with MAGA extension agents in Chiquimula, recalibration with farmers' reports and SEED readings, Mayan languages (Ch'orti', K'iche', Q'eqchi') with native speakers, local drought records outside Guatemala.

---

## Use of NASA Data
Only what the code calls (grep of `internal/`, `cmd/`, `web/src/`):

| Dataset | Where / link | Use |
|---|---|---|
| **NASA POWER** Daily API, community AG | https://power.larc.nasa.gov/api/temporal/daily/point | Core of the engine: ET₀, water balance, rain onset and dry spells, Monte Carlo of 25 seasons (2001–2025), alert thresholds, analogue-year weather after day 16, observed side of the 2026 backtest, and the assistant's "will it rain on date X" frequency (PRECTOTCORR). Fetched on demand for any coordinate, cached on disk. |
| **NASA GIBS** WMTS / WMS | https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/ | Satellite layers in the browser: **MODIS Terra NDVI** (`MODIS_Terra_L3_NDVI_Monthly`), **GPM IMERG** precipitation (`IMERG_Precipitation_Rate`), **MODIS land surface temperature** (`MODIS_Terra_Land_Surface_Temp_Day`, MOD11A1) as the reference of the 3D temperature layer. |
| **NEX-GDDP-CMIP6** (NASA NCCS THREDDS) | https://ds.nccs.nasa.gov/thredds/ | Monthly deltas 2038–2042 vs 2010–2014, SSP2-4.5 and SSP5-8.5: the 2040 plan and risk map. |
| **SRTM** (NASA/USGS) via AWS Terrain Tiles | https://s3.amazonaws.com/elevation-tiles-prod/terrarium/ | 3D relief of the map and the diorama, slope for erosion, temperature correction by elevation. |

## Space Agency Partner Data and Other Data
| Source | Link | Use |
|---|---|---|
| **ESA WorldCover 2021** (Terrascope WMS) | https://services.terrascope.be/wms/v2 | Land cover of the 3D ground. |
| **ESA Copernicus Sentinel-2**: cloudless mosaic (EOX), L2A scenes (Element 84 Earth Search), Esri / Impact Observatory 10 m land cover | https://tiles.maps.eox.at/wmts · https://earth-search.aws.element84.com/v1 · https://ic.imagery1.arcgis.com/ | Imagery under the relief, NDVI greenness layer, land cover. |
| **ECMWF** IFS (16 days) and **SEAS5** (seasonal), **NOAA GFS**, via Open-Meteo | https://api.open-meteo.com/v1 · https://seasonal-api.open-meteo.com/v1 · https://ensemble-api.open-meteo.com/v1 · https://previous-runs-api.open-meteo.com/v1 | Forecast scenario, alerts, 2026 backtest (Historical Forecast), "will it rain" inside 16 days. |
| **NOAA CPC ONI** | https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php | El Niño conditioning. |
| **ISRIC SoilGrids 2.0** | https://rest.isric.org/soilgrids/v2.0 | Soil texture → water holding capacity. |
| **OpenStreetMap** (Overpass, Nominatim, Photon, OpenFreeMap tiles) and **Overture Maps** | https://overpass-api.de/api · https://nominatim.openstreetmap.org · https://photon.komoot.io · https://tiles.overturemaps.org | Search, water, streets, buildings. |
| **Esri World Imagery / World Geocoder** | https://server.arcgisonline.com/ArcGIS · https://geocode.arcgis.com/ | High-resolution imagery for drawing the plot, search. |
| Methods and figures | FAO-56, FAO-33, Saxton & Rawls (2006), Sivakumar (1988), RUSLE; IPC / SESAN Guatemala, FEWS NET, MAGA | Engine methods, food-security figures, documented drought years. |

Full list with licences: `submission/05_partner_data_and_references.md`.

---

## Use of Artificial Intelligence
- **The idea and the method are ours.** The proposal (milpa planning over WhatsApp for the Dry Corridor) was written by a team member before any AI tool was used. The team chose the data, the scientific method (FAO-56, FAO-33, Monte Carlo, analogue forecast, CMIP6 deltas) and reviewed the output.
- **Coding assistant.** We used **Claude Code (Anthropic)** to write and test the Go backend, the Vue web app, the 3D scene, the SEED firmware and case model, tests, deployment files, and the English drafts of these texts.
- **In the product.** The per-field assistant runs on **Claude** (via Claude Code) with tools that call our engine (forecast, NASA POWER frequency, field status, reports). **No number, threshold or recommendation comes from the LLM**: it explains what the engine computed and cites the source. A small logistic-regression model (trained on NASA POWER features, 825 seasons) is compared with plain statistics and both are shown (Brier 0.154 vs 0.161).
- **Voice.** Narration and optional bot voice replies use synthetic speech (**Microsoft Edge neural TTS via edge-tts**) from fixed templates and engine numbers. Farmers' voice notes are transcribed with **faster-whisper** (open model). Ambient sound is synthesized in the browser (Web Audio).
- **Images.** SVG icons and illustrations were written as code by the coding assistant; the 3D scene is procedural code. **No AI image or video generator was used**, and no NASA logo appears in AI-assisted content. Map imagery is real data.

---

## Links
- **Live demo**: https://arasakat-seed.vercel.app (English by default, ES button; "demo account" on the sign-in page)
- **Code**: https://github.com/Astral910/ArasakaT
- **Slides (7, PDF)**: `submission/pitch/SEED_ArasakaT_slides.pdf`
- **Video**: to be recorded at the end ⟦link⟧

---

### Sources of the numbers used above
- Hindcast skill (65 % Chiquimula, 40 % nationwide): `docs/validacion_pronostico.md`.
- Drought validation (5 of 8), AI vs statistics, 2026 alert backtest: `submission/03_detailed_description.md` and the "How do we know?" page.
- Jocotán S0/S1/S2, erosion, bare-soil days: technical report sample (live engine).
- Assistant "will it rain" method and the verified answer ("yes, likely, 51 %" for 20 Oct 2027 in Jocotán): `estado/chat6.md`, `internal/chat/lluvia.go`.
- SEED case: `hardware/prototipo/3d/seed_estacion.scad`; sensor API and station: `docs/sensor.md`, `hardware/README.md`.
- Note: the public demo captured on 15 Nov 2026 (12:00) still runs the round-5 build; the round-6 items above (per-field memory, yes/no rain answer, growth % bar, field page order, tour, FAQ) are merged in their branches and verified there, pending the final deploy.
