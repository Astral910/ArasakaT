# NASA Data

| Dataset | What we use | What it is for |
|---|---|---|
| **NASA POWER** (Prediction Of Worldwide Energy Resources), Daily API, community AG · https://power.larc.nasa.gov/ | T2M_MAX, T2M_MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR, GWETROOT, daily, 2001–2026, on a ~0.5° grid covering Guatemala's 340 municipalities | Core of the engine: FAO-56 Penman-Monteith ET₀, crop water balance, rainfall-onset and canícula detection, Monte Carlo of seasons, the 2001–2026 local climatology used as alert thresholds, and the "observed" side of the 2026 backtest. Root-zone wetness (GWETROOT) as a soil-moisture check. Rain only from 2001 on (source change in the series). |
| **GPM IMERG** (Integrated Multi-satellitE Retrievals for GPM), daily · https://gpm.nasa.gov/data/imerg | Daily precipitation (~10 km) | Local heavy-rain percentiles (P95/P99), dry-spell verification in the 2026 backtest, and the rainfall layer of the map (via NASA GIBS). ⟦TBD: confirm which product the engine finally ingested (IMERG Final/Late via GES DISC or the IMERG component inside POWER)⟧ |
| **MODIS Vegetation Indices** MOD13Q1 NDVI, 250 m, 16-day · https://lpdaac.usgs.gov/products/mod13q1v061/ | NDVI tiles through **NASA GIBS** (Global Imagery Browse Services) · https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api | "X-ray" map layer comparing vegetation in a normal year vs 2026, and a visual cross-check of drought years in validation. |
| **NEX-GDDP-CMIP6** (NASA Earth Exchange Global Daily Downscaled Projections) · https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6 | Monthly temperature and precipitation deltas around 2040 vs the historical baseline, SSP2-4.5 and SSP5-8.5, multi-model | The 2026 ↔ 2040 switch: the same plan recomputed under future climate. |
| **SRTM** (Shuttle Radar Topography Mission) elevation, via AWS Terrain Tiles (terrarium) · https://registry.opendata.aws/terrain-tiles/ | Elevation and slope | 3D relief of the map; municipal mean slope for the erosion estimate. |
| **NASA GIBS** · https://gibs.earthdata.nasa.gov/ | WMTS imagery tiles (MODIS NDVI, IMERG) | Fast satellite layers in the browser without downloading rasters. |
| ⟦TBD if ingested⟧ **SMAP** L3/L4 soil moisture or **GLDAS** · https://smap.jpl.nasa.gov/ · https://ldas.gsfc.nasa.gov/gldas | Root-zone soil moisture | Validation of the water balance. Remove this row if the engine did not use it. |

All NASA data is open and used without login except where noted (Earthdata login for GES DISC products).
