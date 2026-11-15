# Video de la entrega (video4)

1. Servidor con el binario de integración, oculto, en 127.0.0.1:8207 (`ADDR=127.0.0.1:8207`, `SCHEDULER=off`).
2. `node tools/demo-video/grabar.mjs [base] [carpeta] [globo,residencial,jocotan,tel]` → tomas 1080p (Chromium headless con GPU y `--mute-audio`, screencast CDP ~35–60 fps, cursor visible inyectado). Cada toma: `f/*.jpg` + `marcas.json` (tiempos de cada cuadro y marcas: línea de la guía, final, informe, caja del teléfono).
3. `node tools/demo-video/hoja.mjs <toma> <salida.jpg> <t1,t2,…>` → hoja de contacto para elegir tramos.
4. `node tools/demo-video/armar.mjs [tomas] [salida]` → `submission/video/fieldshift-demo-30s.mp4` (1080p60), `-vertical.mp4` (9:16), `subtitles_en.srt`. Los tramos (toma, desde→hasta, duración, zoom, texto) están al principio del script; si se regraban las tomas, revisar los tiempos con la hoja.
Fuentes: Fraunces y Figtree (OFL) instanciadas a TTF en `fuentes/`. Sonido: cama sintetizada con FFmpeg (sin música ajena). Codificación h264_nvenc.
