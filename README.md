# Field Shift · Milpa Planner

**Plan your milpa with NASA satellites, on the phone you already have.**
NASA Space Apps Challenge 2026 · challenge *Field Shift: Adapting Farms with NASA Data* · Team Guatemala.

A decision-support tool for smallholder farmers in Guatemala's Dry Corridor. On **WhatsApp** (or a phone simulator on the web) a farmer sends a location pin and gets a planting calendar and three rotation strategies, current milpa, a Postrera relay and a cover crop, compared with NASA-based risk ranges, water deficit, yield range and a 5-year soil trend. Then it **warns them all season** before dry spells (*canícula*) and heavy rain. Extension workers get a risk map of Guatemala's 342 municipalities.

- 🌐 Live site: ⟦TBD public link⟧ (static, never fails) · API: ⟦TBD backend link⟧
- 📱 Try the bot: phone simulator on the landing page · Twilio sandbox code on the site
- 📄 Submission texts: [`submission/`](submission/) · 🖼 screenshots: [`submission/screenshots/`](submission/screenshots/)

## What it does
| | |
|---|---|
| **Plan** | Planting windows for *Primera* and *Postrera* (P10–P90 of rain onset 2001–2026), typical canícula, bare-soil periods, vulnerable weeks. |
| **Compare** | S0 milpa as usual · S1 sorghum/bean relay · S2 mucuna/canavalia cover crop: seasons lost out of 10, water deficit (mm), yield (qq/mz), soil organic matter and erosion over 5 years, and the five-point sheet (why, evidence, benefits, missing info, risks needing local review). |
| **Adapt** | Farmer priorities (food, water, soil, income) and limits (irrigation, labour, livestock, seed access) re-rank options and add warnings. 2026 ↔ 2040 switch (NEX-GDDP-CMIP6, SSP2-4.5 / SSP5-8.5). |
| **Alert** | Daily 06:00 engine: dry spell, heavy rain, rain onset / false onset, seasonal outlook, frost, weekly follow-up. Probabilities from ensemble forecasts; thresholds from NASA climatology. |
| **Prove** | 2026 time machine: alerts replayed day by day with archived forecasts vs observed rain. Validation table against documented droughts. AI vs statistics comparison. |

The engine is deterministic (FAO-56 Penman-Monteith, root-zone water balance, FAO-33 yield response, Monte Carlo). **AI explains; it never computes a number.**

## Data
NASA POWER (daily T, RH, wind, radiation, rain 2001+), GPM IMERG and MODIS NDVI (map layers via NASA GIBS), NEX-GDDP-CMIP6, SRTM terrain. Partners and others: Copernicus Sentinel-2, Open-Meteo (ECMWF/GFS forecasts and Historical Forecast API), NOAA ONI, geoBoundaries, ISRIC SoilGrids. Full list: [`submission/04_nasa_data.md`](submission/04_nasa_data.md), [`submission/05_partner_data_and_references.md`](submission/05_partner_data_and_references.md).

Honesty rules: results are per **municipality / climate zone**, not per plot; every number is a range with its source; the 1–2-week forecast is ECMWF/GFS, not NASA.

## Architecture
```
cmd/server         one Go binary: REST API, WhatsApp webhooks, alert scheduler, embedded Vue front
cmd/ingest         downloads and cleans NASA data → data/
internal/fao56     ET0 Penman-Monteith, Kc, water balance, Ky
internal/sim       scenarios, Monte Carlo, CMIP6, soil, calendar
internal/plan      POST /api/plan, municipalities, risk map
internal/ml        small AI model vs statistics
internal/valid     validation against documented droughts
internal/bot       channel-independent conversation (ES/EN)
internal/channels  WhatsApp Cloud API, Twilio, web simulator
internal/cards     PNG plan cards
internal/alerts    subscriptions, daily rules, templates, 2026 backtest
internal/forecast  16-day + ensemble forecasts, archive
internal/store     SQLite (pure Go)
internal/contract  shared types
web/               Vue 3 + Vite + TypeScript (static mode reads web/public/static/*.json)
e2e/               Playwright end-to-end tour
submission/        texts for the Space Apps portal
```

## Run locally
Requirements: Go 1.26+, Node 22+.
```sh
cp .env.example .env          # everything optional; no credentials = simulator only
scripts/build.sh              # Windows: powershell -File scripts\build.ps1
bin/fieldshift-server         # http://127.0.0.1:8200
```
Development: `go run ./cmd/server` with `WEB_DIR=web/dist`, or the Vite dev server in `web/` (`npm run dev`, proxies `/api`).

| Route | What |
|---|---|
| `GET /healthz` | status and which components are live |
| `POST /api/plan` · `GET /api/municipios` · `GET /api/riesgo?horizonte=` | engine |
| `POST /api/chat` · `GET/POST /webhook/whatsapp` · `POST /webhook/twilio` · `GET /api/cards/plan.png` | bot |
| `POST /api/alerts/subscribe` · `GET /api/alerts/backtest` · `GET /api/alerts/timeline` | alerts |
| `GET /api/admin/resumen` (public counts, no phone numbers) · `POST /api/admin/run-alerts?date=` (`Authorization: Bearer $ADMIN_TOKEN`) | extension panel / admin |

## Tests
```sh
go test -p 1 ./...
cd web && npx vitest run --maxWorkers=2
cd e2e && npm ci && npx playwright test     # headless tour with screenshots
```

## Deploy
Static site on Vercel or GitHub Pages (works without the backend) + Go backend on Render or Fly. Step by step: [`docs/deploy.md`](docs/deploy.md).

## Limits and next steps
WhatsApp runs on Meta's test number (up to 5 registered phones) plus the Twilio sandbox; production needs Meta business verification and approved templates. Next: pilot with MAGA extension agents in Chiquimula, field data from the weekly follow-up, Mayan languages with native speakers, an educational game on the same engine.

## License
⟦TBD: team picks a license (MIT suggested)⟧. Data keeps its original licenses (see references).
