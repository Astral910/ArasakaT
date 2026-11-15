# Space Agency Partner Data & Other References

## Space agency partner data
- **Copernicus Sentinel-2** (ESA) through *Sentinel-2 cloudless 2020 by EOX IT Services GmbH* (contains modified Copernicus Sentinel data 2020), CC BY-NC-SA 4.0, base imagery of the map. https://s2maps.eu/
- **ESA WorldCover 2021** 10 m land cover (Sentinel-1/2), CC BY 4.0, Zanaga et al. (2022), https://esa-worldcover.org/ — first choice for the ground materials of the 3D diorama. When the Terrascope service does not answer, the diorama uses **Esri / Impact Observatory 10 m Land Use/Land Cover** (Sentinel-2, 2024), CC BY 4.0, https://livingatlas.arcgis.com/landcover/.

## Other data
- **Open-Meteo**: 16-day forecast, ensemble forecast (ECMWF IFS ENS, NOAA GFS ENS) and Historical Forecast API (archived forecasts for the 2026 backtest). https://open-meteo.com/ (CC BY 4.0). Forecast models: ECMWF, NOAA NCEP GFS.
- **NOAA CPC Oceanic Niño Index (ONI)**: ENSO state per season, used to condition the Monte Carlo and the seasonal outlook. https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php
- **geoBoundaries** Guatemala ADM2 (342 municipalities; source CONRED/OCHA), CC BY 3.0 IGO. Runfola et al. (2020), *geoBoundaries: A global database of political administrative boundaries*, PLOS ONE 15(4): e0231866. https://www.geoboundaries.org/
- **ISRIC SoilGrids** 250 m (texture, organic carbon), CC BY 4.0, https://soilgrids.org/. Where the service returned no data, typical values from the Guatemalan soil classification (Simmons et al. 1959; MAGA 2000) were used and flagged for local soil analysis.
- **FAO GAEZ** (reference for crop suitability context). https://gaez.fao.org/
- **Esri World Imagery** (satellite base imagery of the maps, the flight and the diorama) and **Esri World Geocoder** (place search). Sources: Esri, Maxar, Earthstar Geographics and the GIS user community. https://www.arcgis.com/
- **Terrain Tiles (Terrarium) on AWS Open Data** (SRTM-based elevation for the 3D relief). https://registry.opendata.aws/terrain-tiles/
- **Overture Maps Foundation** buildings (OpenStreetMap, Google Open Buildings, Microsoft Global ML Building Footprints), ODbL / CDLA Permissive 2.0, footprints of the neighbouring houses in the diorama. https://overturemaps.org/
- **OpenStreetMap** contributors (ODbL): streets, street trees, rivers and lakes via Overpass API and OpenFreeMap vector tiles; place search via Photon (komoot) and Nominatim. https://www.openstreetmap.org/copyright

## Methods
- Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). *Crop evapotranspiration: Guidelines for computing crop water requirements*. FAO Irrigation and Drainage Paper 56.
- Doorenbos, J., Kassam, A.H. (1979). *Yield response to water*. FAO Irrigation and Drainage Paper 33.
- Saxton, K.E., Rawls, W.J. (2006). Soil water characteristic estimates by texture and organic matter for hydrologic solutions. *Soil Sci. Soc. Am. J.* 70: 1569–1578.
- Renard, K.G. et al. (1997). *Predicting soil erosion by water: a guide to conservation planning with RUSLE*. USDA Agriculture Handbook 703.
- Lo, A., El-Swaify, S.A., Dangler, E.W., Shinshiro, L. (1985). Effectiveness of EI30 as an erosivity index in Hawaii. In: *Soil Erosion and Conservation*, Soil Conservation Society of America, 384–392 (tropical annual R-factor relation used by the engine).
- Thrasher, B. et al. (2022). NASA Global Daily Downscaled Projections, CMIP6. *Scientific Data* 9: 262.
- Sivakumar, M.V.K. (1988). Predicting rainy season potential from the onset of rains in Southern Sahelian and Sudanian climatic zones of West Africa. *Agricultural and Forest Meteorology* 42: 295–305.
- Simmons, C.S., Tárano, J.M., Pinto, J.H. (1959). *Clasificación de reconocimiento de los suelos de la República de Guatemala*; MAGA (2000) soil maps.
- Reference yields and producer prices: MAGA / ICTA (approximate; rain-fed landrace maize ≈30 qq/mz, black beans ≈12 qq/mz); MAGA producer prices 2025.

## Drought and food-security sources (validation and context)
- FEWS NET Guatemala food security outlooks. https://fews.net/latin-america-and-caribbean/guatemala
- IPC / SESAN Guatemala Acute Food Insecurity Analysis, May 2025–April 2026 (3.4 million people in Phase 3+ in May–Aug 2025). https://www.ipcinfo.org/ipc-country-analysis/details-map/en/c/1159721/
- CIF / SESAN Guatemala 2026–2027 analysis (3.2 million people in Phase 3+ projected for Jul–Sep 2026). https://portal.siinsan.gob.gt/wp-content/uploads/20260812-CIF-2026-2027.pdf
- MAGA Guatemala (Ministry of Agriculture) drought and crop-loss reports. https://www.maga.gob.gt/
- Oxfam (2026). *Informe Centroamérica: Fenómeno de El Niño*. https://lac.oxfam.org/
- Infobae (2026-09-02). *El Niño 2026 en Guatemala: canículas largas, maíz perdido…* https://www.infobae.com/guatemala/

## Software and libraries
- Go 1.26 standard library · `github.com/fogleman/gg` (MIT) and `github.com/golang/freetype` (FreeType/BSD) for PNG cards · `modernc.org/sqlite` (BSD-3) · `golang.org/x/image`, `golang.org/x/text` (BSD-3) · `github.com/google/uuid` (BSD-3).
- Vue 3, Vite, TypeScript, Pinia, Vue Router (MIT) · MapLibre GL JS (BSD-3) · GSAP (GreenSock standard license, free) · Lucide icons (ISC) · Vitest, Playwright (MIT / Apache-2.0).
- WhatsApp: Evolution API v2 (Apache-2.0, self-hosted, Baileys) · whatsmeow (MPL-2.0).
- 3D sandbox: three.js (MIT) · `mp4-muxer` (MIT) + WebCodecs for in-browser video · Go compiled to WebAssembly (engine offline) · `github.com/chromedp/chromedp` (MIT) + ffmpeg (LGPL/GPL, NVENC) for server-rendered videos.
- Messaging: Meta WhatsApp Cloud API · Twilio WhatsApp Sandbox.
- Fonts: Fraunces (Undercase Type) and Figtree (Erik Kennedy), both SIL Open Font License 1.1, self-hosted via Fontsource.
- Hosting: Render / Fly.io (backend), Vercel / GitHub Pages (static site).

## Images, music, video
- All illustrations are original SVG drawn for this project. ⟦TBD: list any AI-generated image (must carry a visible watermark) or third-party image⟧.
- The demo video is a screen recording of our own app (headless browser, real takes of the live tool; `tools/demo-video/`). Sound: an ambient bed synthesised with FFmpeg (low chord, wind, rain during the storm shot); no third-party music, samples or voice.
- No NASA logos are used in any generated content.
