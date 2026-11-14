# Detailed Project Description

## The problem
In Guatemala's Dry Corridor (Chiquimula, Zacapa, El Progreso, Jutiapa, Baja Verapaz) most families grow *milpa*, maize intercropped with beans, on steep hillsides with no irrigation. The year has two rain-fed seasons, *Primera* (May–August) and *Postrera* (August–November), split by the *canícula*, a mid-summer dry spell. When the canícula comes early or lasts too long, the maize is flowering and the harvest is lost. El Niño years make that more likely; 2026 is one of them. After harvest, the soil is usually left bare through the dry season, so the first heavy rains wash it downhill.

The Field Shift challenge asks for a tool that uses NASA Earth observations, local soil, crop characteristics and the farmer's own priorities to compare crop rotation strategies that improve soil health and help the farm adapt. Our users do not use farm apps or GIS. They use WhatsApp.

## Who it is for
1. **The milpa farmer**, through a WhatsApp bot that needs no app, account or reading of maps.
2. **The producer or cooperative**, who plans several plots on the web.
3. **The extension worker** (MAGA, NGOs), who follows many farmers and needs a map of where risk is highest.

## How it works

### 1. On WhatsApp
1. The farmer writes "hola" and sends a **location pin** (or types the municipality). The pin is matched to one of Guatemala's 342 municipalities (point-in-polygon on geoBoundaries ADM2). We say "your municipality or climate zone", never "your exact plot": NASA climate data comes in 25–55 km cells.
2. Interactive lists and buttons ask: what do you plant (milpa, maize, beans, sorghum), how big (in *cuerdas* or *manzanas*, the local units), irrigation yes/no, livestock that needs fodder, labour available, access to mucuna or canavalia seed, and what matters most (securing food, saving water, improving the soil, earning more). These are the farmer's **priorities and limits**.
3. The bot answers with a four-line summary, a **plan card image** (12-month calendar, the three options, risk) ready to forward to the community group, and a link that opens the full plan on the web. Replying 1, 2 or 3 shows the detail of each strategy. Commands: MENU, CAMBIAR (change answers), EN (English), AYUDA, BAJA/STOP.
4. At the end it offers **alerts**: "Do you want me to warn you if a dry spell or heavy rain is coming?" Opt-in only, minimum data (phone, municipality, crop, strategy, planting date, language, consent date), masked phone numbers in logs, and BAJA to leave at any time.

The same bot runs in a **phone simulator on the website**, so judges can try the full conversation without registering a number. It also runs on the Meta WhatsApp Cloud API test number and on the Twilio WhatsApp Sandbox (anyone can join with a code shown on the site).

### 2. The plan (web and card)
- **Planting calendar** for the municipality: the *Primera* and *Postrera* planting windows (P10–P90 of the rainfall-onset date over 2001–2026), the typical canícula, the **bare-soil periods** of each strategy, and the weeks when the crop is most vulnerable (flowering during the canícula). Shown as an animated 12-month ring.
- **Three strategies**, compared side by side:
  - **S0 · Milpa as usual** (the farmer's current practice): maize + beans in Primera, beans in Postrera, bare soil in the dry season.
  - **S1 · Postrera relay**: drought-tolerant sorghum or beans relayed into Postrera, residue kept on the ground.
  - **S2 · Cover crop**: mucuna or canavalia after the main crop (nitrogen fixation, ground cover, fodder). If the farmer has no seed, S2 carries the warning "get seed" or switches to canavalia.
- For each strategy: **seasons lost out of 10** (P10–P50–P90), **water deficit** in mm, **yield range** in quintals per manzana, **soil organic-matter index over 5 years**, **erosion** (t/ha/year), days of bare soil, and the **five-point sheet** the challenge requires: *why it is suggested, evidence, benefits, missing information, risks that need local review*.
- Priorities and limits re-rank the strategies and add warnings (no labour → no cover crop that needs slashing; livestock → mucuna/sorghum as fodder).
- **2026 ↔ 2040 switch**: the same plan recomputed with CMIP6 climate deltas (SSP2-4.5 and SSP5-8.5).

### 3. Alerts all season
Every day at 06:00 Guatemala time an alert engine runs for each subscriber, idempotently (never the same alert twice):
- 🌵 **Dry spell / canícula**: the 16-day forecast shows ≥ 7 consecutive dry days starting within 10 days in at least half of the models/members → alert with a **probability** (share that agree). Each model's dry-day threshold (1–5 mm) is calibrated so its dry-day frequency matches NASA POWER 2001–2025, because forecast models drizzle almost every day in the tropics.
- 🌧 **Heavy rain**: a forecast day above each model's calibrated threshold (as frequent as NASA POWER exceeding its local 95th percentile, 22 mm in Jocotán) in the next 7 days → erosion and landslide warning. Without an archive to calibrate: a day above the local 99th percentile (capped at 50 mm) or 3 days above the 95th.
- 🌱 **Rain onset / planting window**, and **false onset** when a dry spell follows.
- ☀️ **Seasonal outlook** from the ENSO state and analogue years in the NASA record.
- ❄️ **Frost** (highlands): forecast minimum ≤ 3 °C.
- 🤝 **Weekly follow-up**: "How is your milpa? [Fine] [Yellow leaves] [Drying] [Lost]". Answers are stored as field data for validation and for the extension worker's map.

Every alert follows the same order: *what is coming · when · how sure we are · what to do · ask your extension agent*. The text adapts to the crop stage (planting date + FAO-56 crop stages): "your maize will be flowering, its most water-sensitive stage". Outside WhatsApp's 24-hour window, alerts use pre-approved Utility templates.

We are explicit about who forecasts what: **the 1–2-week forecast comes from ECMWF/GFS (via Open-Meteo), not NASA**. NASA data tells us what is normal in each place (thresholds), what is happening now (monitoring) and how good the alerts are (validation).

### 4. The 2026 time machine (backtest)
We replayed the alert engine day by day over the real 2026 season with **archived forecasts** (Open-Meteo Historical Forecast API) and compared every alert with what actually happened (NASA POWER observed rain). Result for Jocotán, May–November 2026 (195 days replayed, no missing forecast day): **6 dry-spell alerts issued, 5 confirmed by the observed rain and 0 false alarms**; 3 of the 7 observed dry spells were warned in advance (median lead time 2 days); the rain-onset alert was right with 4 days of lead time. Heavy rain is harder: 14 heavy-rain alerts, 3 confirmed and 11 false alarms (precision 21 %, versus 6 % by chance), but both observed multi-day heavy-rain episodes were flagged. Camotán gives similar numbers (5 of 6 dry-spell alerts confirmed, 1 false alarm). Headline: *we would have warned Jocotán on 17 October 2026, 7 days before an 8-day dry spell began*. We show the misses too: short-range dry-spell forecasting is only moderately skilful, which is why every alert carries a probability. The web shows it as a timeline: the real 2026 rain as soft bars, the real canícula shaded, and WhatsApp bubbles dropping on the days the farmer would have been warned.

### 5. The extension worker's map
A 3D relief map (SRTM terrain, Sentinel-2 cloudless imagery) of Guatemala's 342 municipalities coloured by seasonal risk (2026 or 2040), with ranking, filters, CSV export, and an "X-ray" slider that reveals the MODIS NDVI and IMERG rainfall layers for a chosen year (e.g. 2023 vs 2026), as visual proof of what the satellites saw. The alerts panel shows subscribers per municipality (counts only, no phone numbers), active alerts, a message preview and follow-up answers.

### 6. The 3D sandbox: see your season before you plant it
"See it in 3D" (on the plan, or the VIDEO 🎬 command in WhatsApp) opens a continuous shot: Guatemala's risk map → a flight down to the municipality's real terrain (SRTM relief, Sentinel-2 imagery) → the farmer's plot rising as a small diorama on the real slope. Then the season plays as a timelapse **driven day by day by the same engine** (`POST /api/simulate`): rain, soil water, crop stage and stress, residue on the ground, dry spells, storms above the local 95th percentile, heat, frost, planting and harvest, with a HUD showing soil water, crop stress, expected harvest and organic matter. The farmer can change the strategy (S0/S1/S2), irrigation (none, 10, 20 or 35 mm per week), scenario (typical year, El Niño year, real 2026, multi-year run, 2040) and case (P10/P50/P90), jump to any event on the timeline, and compare **S0 | S2 side by side on the same day**. Honesty is built in: a future season cannot be forecast day by day, so each simulated season replays the real NASA POWER weather of a past year (resampling) and says which one ("real 2013 weather, resampled"); plants are drawn to scale only approximately, the numbers are the engine's. The sandbox also runs **without a server**: the engine is compiled to WebAssembly, so the static site recalculates in the browser (20–40 ms per run). A 20–30 s video of the season can be exported in the browser (H.264) or sent by the bot (`GET /api/sim/video.mp4`, rendered by the server with headless Chromium and cached), ready to forward to a WhatsApp group.

## The engine (deterministic; AI explains, never computes)
1. **Reference evapotranspiration** ET₀, FAO-56 Penman-Monteith, daily, from NASA POWER (T2M_MAX, T2M_MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN).
2. **Crop water demand** ETc = Kc × ET₀ for maize, beans, sorghum, mucuna and canavalia (FAO-56 Kc tables and stage lengths).
3. **Root-zone water balance** with total available water from soil texture (Saxton & Rawls pedotransfer) and the FAO-56 stress coefficient Ks; rain from PRECTOTCORR (2001+ only, see *Uncertainty*).
4. **Yield loss** with the FAO-33 relation 1 − Ya/Ym = Ky (1 − ETa/ETc), applied to an approximate water-unstressed reference yield for rain-fed landrace maize (≈30 qq/mz), beans (≈12 qq/mz) and sorghum (MAGA/ICTA references), reported as a range in qq/mz, never a single number.
5. **Strategies as season sequences** over at least 5 years (Primera → Postrera → dry season, year 1 → 5).
6. **Planting calendar**: rain onset per year with a rule adapted from Sivakumar (1988): the first day with ≥ 20 mm in 3 days and no dry spell of ≥ 7 days in the following 30 days (otherwise it is a *false onset*), canícula detection, bare-soil days per strategy.
7. **Monte Carlo**: 10,000 seasons resampled from the real 2001–2026 years, conditioned on El Niño yes/no (NOAA ONI) → "X of 10 seasons", P10/P50/P90. In Jocotán, today's practice loses 5.1 of every 10 seasons in El Niño years versus 2.9 in other years.
8. **2040**: monthly temperature and precipitation deltas from NEX-GDDP-CMIP6 (ACCESS-CM2, MRI-ESM2-0, MPI-ESM1-2-HR; 2038–2042 vs 2010–2014; SSP2-4.5 and SSP5-8.5) applied to the observed series.
9. **Soil**: organic-matter index and erosion with the RUSLE cover factor C per strategy and rainfall erosivity; labelled "approximate".

## Uncertainty, shown, not hidden
- Every important number is a **P10–P90 band** and carries a data tag, e.g. "Water deficit 182 mm · NASA POWER + IMERG · 2001–2026".
- Spatial honesty: results are for the **municipality or climate zone**, not the plot.
- NASA POWER rainfall changes source around 2000 (May–August mean in Jocotán jumps from 429 mm in 1981–2000 to 731 mm in 2001–2025), so we only use **2001 onwards** for rain.
- Alerts always carry a probability; the time-machine table shows their real hit rate.
- Yields have ±30–50 % uncertainty; we show ranges and direction ("S2 lowers the deficit by X mm"), not promises.

## Validation
We checked whether the engine flags the drought years documented by FEWS NET, MAGA and SESAN between 2001 and 2025: **detected 5 of 8** in Jocotán (2001, 2014, 2015, 2018, 2019 detected; 2009, 2012, 2023 missed), with 4 false alarms (2003, 2004, 2024, 2025). In Camotán: 4 of 8. As an independent check, MODIS NDVI (Aug–Sep) was low in 2 of the 8 documented years. The full year-by-year table is on the *How do we know?* page. POWER's ~50 km cells smooth out local rain; adding GPM IMERG at ~10 km is our first improvement. The 2026 time machine validates the alerts separately (hits, false alarms, lead time).

## AI vs statistics
The challenge asks to compare an AI approach with a statistical one. We trained a logistic regression on four inputs known at planting time (ONI for April–June, standardised rain from 15 April to 31 May, NASA POWER root-zone wetness GWETROOT in May, and April–May maximum temperature), using 825 seasons (33 NASA POWER zones × 2001–2025), and compared it with the plain statistical approach (loss frequency by zone and El Niño state). With leave-one-year-out validation the Brier error is 0.155 for the AI model and 0.160 for statistics: the AI is slightly better, but the difference is small, so the engine keeps the transparent statistical estimate and shows both. The web explains both in plain language. Large language models are **optional** and switched off by default: if enabled, they only interpret free text and phrase answers using the engine's numbers. **No number comes from an LLM**; the bot works end to end without one.

## Supports, does not replace
Every plan and every alert ends with "check with your extension agent". The five-point sheet lists the missing information and the risks that require local review (seed availability, slope, land tenure, pests).

## Why it matters
3.4 million people in Guatemala (19 % of the population) faced acute food insecurity (IPC Phase 3 or above) in May–August 2025, and 3.2 million are projected for July–September 2026 (IPC/SESAN), and El Niño 2026 brought long dry spells to the Dry Corridor. A free WhatsApp number that knows the local climate, warns before the dry spell and suggests a soil-friendly rotation can reach farmers that no app reaches.

## What works today and next steps
- **Today**: web (English/Spanish) with static fallback so the public link never fails; 3D season sandbox (server, WebAssembly or precomputed JSON) with video export; Go backend with the WhatsApp Cloud API test number (up to 5 registered phones, as Meta allows for testing), the Twilio sandbox and the web simulator; alert engine with the 2026 backtest.
- **Next**: Meta business verification and approved templates for production; a pilot with MAGA extension agents in Chiquimula; field data from the weekly follow-up to recalibrate; voice notes and Mayan languages (Ch'orti', K'iche', Q'eqchi') built with native speakers; an educational game that reuses the same engine.

## Tools
Go (standard library HTTP server, FAO-56 engine, PNG plan cards with fogleman/gg, SQLite via modernc.org/sqlite), Vue 3 + Vite + TypeScript, Pinia, Vue Router, MapLibre GL, GSAP, Lucide icons, Vitest, Playwright. Deployed as one Go binary with the web embedded (Docker on Render/Fly) plus a static copy of the site (Vercel / GitHub Pages) that works without the backend.
