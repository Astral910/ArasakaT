# Video del sandbox 3D (exportar y mandar por WhatsApp)

Vault nota 25 §6. Dos caminos, el mismo resultado visual (mismo compositor `web/src/features/sandbox/export/marca.ts`):

| Camino | Dónde | Cómo |
|---|---|---|
| **Exportar en la web** | navegador del usuario | botón "Exportar video" → `exportarVideo(sandbox, opciones)` → MP4 H.264 con WebCodecs + `mp4-muxer`, cuadro por cuadro (fluido aunque la compu sea lenta). 720p/1080p, horizontal o celular, 15–30 s, toma completa o rango. Sin WebCodecs (Firefox viejo, Safari < 16.4): WebM con MediaRecorder y aviso de que WhatsApp no lo acepta. |
| **VIDEO 🎬 por WhatsApp** | servidor | `GET /api/sim/video.mp4?<consulta>` → caché en disco → si no, Chromium headless abre `/sandbox?rec=1&…`, pide cada cuadro ya compuesto (`window.__fsRec.cuadro(k)`, JPEG) y ffmpeg lo codifica (h264_nvenc si hay GPU NVIDIA, libx264 si no), `+faststart`, ≤ 16 MB. |

Cada video lleva: título (municipio, cultivo, estrategia, escenario, riego), HUD con los **números del motor** día a día (fecha, agua en el suelo, salud del cultivo, lluvia, riego, cosecha del año, "NASA POWER · clima real de 2013"), avisos de eventos (tormenta, racha seca, calor, helada, siembra, cosecha), franja de huipil y tarjeta final con la cosecha media del motor y las **fuentes** (NASA POWER, SRTM, SoilGrids, NEX-GDDP-CMIP6, NOAA ONI, FAO-56/33) + "escena ilustrativa; el número de plantas está escalado".

## Consulta (parámetros)
`municipio_id, cultivo, estrategia (S0|S1|S2), riego_mm_semana (0|10|20|35 = nada/poco/medio/mucho), escenario (tipico|nino|real-2026|secuencia|2040-ssp245|2040-ssp585), percentil, anios, idioma (es|en), calidad (720p|1080p), vertical=1`. Los mismos que lee `/sandbox`.

Orden de búsqueda (`internal/simvideo.Servicio.Obtener`): **caché** (`SIMVIDEO_CACHE`, clave = hash de la consulta) → **precalculado exacto** (`web/public/static/video/<municipio>_<S>_<escenario>_<riego>[_en].mp4`) → **render** → **precalculado aproximado** (mismo municipio o Jocotán; header `X-Video-Fuente: aproximado`). Un render a la vez; pedidos repetidos esperan al mismo; el render sigue aunque el cliente corte (queda en caché).

Estado: `GET /api/sim/video/estado` → `{render, encoder, precalc, cache, base}`.

## Bot
- Pregunta nueva de **riego**: lista *Nada · Poco (~10 mm/semana) · Medio (~20) · Mucho (~35)* → `PlanRequest.riego_mm_semana` (el motor lo usa en el balance de agua). "sí"/"no" por texto = medio/nada.
- Después del plan: botón **🎬 Ver mi milpa 3D** y comando **VIDEO** (también `3D`). Manda "Preparando…", el MP4 (estrategia que miró en detalle o la recomendada, su riego, su idioma) y el link a `/sandbox?…` en la web.
- WhatsApp Cloud: genera/toma el MP4, lo sube a `POST /{phone-number-id}/media` (`video/mp4`) y lo manda por id con caption. Si falla, manda el texto con el link al MP4.
- Twilio: `MediaUrl = PUBLIC_URL + /api/sim/video.mp4?…` (Twilio lo descarga; ≤ 16 MB).
- Simulador web: mensaje `{"tipo":"video","video_url":"/api/sim/video.mp4?…"}` → burbuja con reproductor.

## Qué hace falta en la nube
1. **Chromium + ffmpeg + fuentes** en la imagen (Debian):
   ```dockerfile
   RUN apt-get update && apt-get install -y --no-install-recommends \
       chromium ffmpeg fonts-noto-color-emoji fonts-dejavu-core ca-certificates \
     && rm -rf /var/lib/apt/lists/*
   ENV CHROME_PATH=/usr/bin/chromium SIMVIDEO_CACHE=/data/video
   ```
   (Alpine: `apk add chromium ffmpeg font-noto-emoji`.) Sin GPU usa `libx264` y WebGL por SwiftShader: ~1–3 min por video de 28 s en 1 vCPU; con caché solo la primera vez.
2. El servidor tiene que poder abrirse a sí mismo: `SIMVIDEO_BASE_URL` (por defecto `http://127.0.0.1:$PORT`) y la web construida servida en `/sandbox`.
3. Disco para la caché (`SIMVIDEO_CACHE`; poda a 300 archivos). En Render/Fly usar el volumen de `/data`.
4. RAM: Chromium headless ~300–500 MB mientras graba.
5. Si el plan gratuito no aguanta Chromium: `SIMVIDEO_RENDER=off` → solo caché + **precalculados** (Jocotán y Camotán · S0/S2 · típico/El Niño · sin riego, 720p, ~6 MB c/u) y el aproximado para el resto. El bot nunca se queda sin video.

Variables: `SIMVIDEO_BASE_URL`, `SIMVIDEO_RUTA` (/sandbox), `SIMVIDEO_CACHE`, `SIMVIDEO_PRECALC`, `SIMVIDEO_RENDER=off`, `SIMVIDEO_ENCODER` (h264_nvenc|libx264), `CHROME_PATH`, `FFMPEG_PATH`.

## Regenerar los precalculados
Con la web corriendo (vite o el servidor):
```
go run ./internal/simvideo/precalc -base http://127.0.0.1:8204 -ruta /sandbox -forzar
```
(`-municipios`, `-estrategias`, `-escenarios`, `-riego`, `-idiomas`, `-bitrate`.) En Git Bash anteponer `MSYS_NO_PATHCONV=1` si la ruta empieza con `/`.

## Pruebas
- `go test -p 1 ./internal/simvideo ./internal/bot ./internal/channels` (canal falso de Meta, Twilio y simulador).
- Render real: `SIMVIDEO_E2E_URL=http://127.0.0.1:8204/sandbox go test -run E2E -v ./internal/simvideo`.
- Navegador: `node web/src/features/sandbox/export/banco/probar.mjs salida.mp4` (Playwright headless, silencioso).
- `vitest` en `web/src/features/sandbox/export/plan.test.ts`.

## Clip del /demo (`web/public/static/demo/sandbox.mp4`)
Se regenera cuando cambia la escena (servidor en 127.0.0.1:8200, caché de videos vacía):
1. Toma 1080p del motor: `curl -o s2_1080.mp4 "http://127.0.0.1:8200/api/sim/video.mp4?municipio_id=jocotan-chiquimula&cultivo=milpa&estrategia=S2&escenario=tipico&riego_mm_semana=0&idioma=en&calidad=1080p"`.
2. Comparar S0 | S2 en vivo: `cd e2e && node grabar-comparar.mjs http://127.0.0.1:8200 <carpeta> 4`, luego `ffmpeg -f concat -i <carpeta>/lista.txt -vf fps=30,format=yuv420p -c:v h264_nvenc -b:v 8M comparar.mp4`.
3. Unir (la comparación empieza a los 9.9 s, como espera `Demo.vue`):
   `ffmpeg -i s2_1080.mp4 -i comparar.mp4 -filter_complex "[0:v]trim=0:18.81,setpts=(PTS-STARTPTS)/1.9,fps=30,format=yuv420p[a];[1:v]trim=0.6:3.533,setpts=PTS-STARTPTS,fps=30,scale=1920:1080,format=yuv420p[b];[a][b]concat=n=2:v=1[v]" -map "[v]" -c:v h264_nvenc -preset p7 -b:v 3.6M -movflags +faststart -an sandbox.mp4`.
4. Precalculados: `go run ./internal/simvideo/precalc -base http://127.0.0.1:8200 -forzar`. Video de la entrega: `node record-demo.mjs "http://127.0.0.1:8200/demo?autostart=1&rec=1" 29.9 --skip=1.4`.

Fidelidad escena ↔ motor: `cd e2e && node fidelidad.mjs <vite> <api> <carpeta>` (5 días: racha seca, tormenta, desarrollo, llenado, cosecha).
