# Hardware · estación de campo FieldShift

Prototipo que mide la humedad del suelo (10 y 30 cm), la temperatura del suelo y del aire y la lluvia (mm y hora de cada golpe) y lo manda al motor como respaldo de los datos. Guía completa: [`docs/sensor.md`](../docs/sensor.md).

| Carpeta | Qué hay |
|---|---|
| `diagrama/` | `index.html` (diagrama, pines por placa, resistencias, lista de materiales) · `diagrama.svg` · `generar.py` |
| `3d/` | modelos OpenSCAD paramétricos (`*.scad`), `stl/`, `3mf/`, `render/`, `chequeo.scad` (interferencias) y `exportar.sh` |
| `firmware/` | PlatformIO + Arduino para ESP32-C3 (principal), ESP32-S3 y ESP32 clásico |
| `simulador/` | `go run ./hardware/simulador`: manda lecturas falsas realistas al servidor (lluvia sorpresa, secado) |

## En 5 pasos

1. **Imprimir** en PETG o ASA (no PLA): caja + tapa (+ junta en TPU), pluviómetro (embudo, base, balancín), abrigo (base, 6 platos, techo), soporte del panel (bandeja + 2 orejas), 3 abrazaderas + contras, estaca y 2 protectores. Todo sin soportes. Renders en `3d/render/`.
2. **Soldar** la placa perforada de 5×7 cm según `diagrama/diagrama.svg` (colores de cable y valores de resistencias en el diagrama).
3. **Firmware**: `cd firmware && pio run -e esp32c3 -t upload`. Calibrar los sensores en un vaso con suelo del lugar seco y saturado (comandos `seco10`, `moj10`, `seco30`, `moj30` en el monitor serie).
4. **Alta** en el servidor: `POST /api/sensores {"parcela_id": "…"}` → ID y token; cargarlos en el portal WiFi "FieldShift-Estacion" (aparece la primera vez o con doble RESET).
5. **Instalar**: sensores a 10 y 30 cm junto a las plantas, pluviómetro nivelado lejos de goteras, abrigo a 1,25–2 m, panel al sur inclinado ≈ latitud (≥ 15°).

## Pluviómetro

Boca de 100 mm (7 854 mm²); con 1,571 mL por golpe → **0,20 mm por golpe**. Se calibra vertiendo 157 mL (= 20 mm) y contando golpes: `mm_golpe = 20 / golpes`.

## Verificación hecha

- `pio run` para `esp32c3`, `esp32s3` y `esp32dev`: compila sin errores.
- `bash 3d/exportar.sh`: exporta STL/3MF/PNG y corre 15 chequeos de interferencia (tienen que dar "LIBRE").
- `go test -p 1 ./internal/sensores/`: conversión, lluvia sorpresa, secado → regar, búfer y reenvío, token malo → 401.
