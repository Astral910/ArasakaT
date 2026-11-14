# Coordinación de agentes (6 en paralelo + verificador al final)

Encargo general: vault `C:\Users\Pc\SpaceApps2026-Cerebro\` notas **19** (brief), **20** (visual), **23** (alertas). Cada agente cumple **su parte** de ese brief.

## Agentes, carpetas y ramas
| Agente | Worktree (su carpeta) | Rama | Es dueño de |
|---|---|---|---|
| **motor** | `C:\Users\Pc\spaceapps-fieldshift` | `construccion-herramienta` | `cmd/ingest`, `data/`, `internal/{data,fao56,geo,sim,ml,valid,plan}`, `web/public/static/` (JSON del modo estático) |
| **bot** | `C:\Users\Pc\spaceapps-wt\bot` | `feat/bot` | `internal/{bot,channels,cards}` |
| **alertas** | `C:\Users\Pc\spaceapps-wt\alertas` | `feat/alertas` | `internal/{alerts,forecast,store}` |
| **web** | `C:\Users\Pc\spaceapps-wt\web` | `feat/web` | `web/` (todo, salvo `web/src/features/{mapa,alertas,how}`) + `package.json` |
| **webdatos** | `C:\Users\Pc\spaceapps-wt\webdatos` | `feat/webdatos` | `web/src/features/{mapa,alertas,how}` |
| **integrador** | `C:\Users\Pc\spaceapps-wt\integrador` | `integracion` | `cmd/server`, `e2e/`, `submission/`, `README.md`, despliegue (Dockerfile, render.yaml, vercel.json), merges |

**Regla de oro: solo tocás tus carpetas.** `internal/contract` es compartido: solo se **agregan** campos (nunca renombrar), y se avisa en "Cambios al contrato" abajo. Si necesitás algo de otro agente, lo pedís en "Pedidos" y mientras usás un falso (fixture o mock).

## Contrato
- Tipos Go: `internal/contract/contract.go` (PlanRequest, Plan, Estrategia, Ficha, Mensajero, MensajeChat, Suscriptor, Alerta).
- Fixture de desarrollo: `contracts/fixtures/plan_jocotan.json` (**números de ejemplo, no reales**; el motor lo reemplaza con salida real lo antes posible y lo dice aquí).
- Rutas HTTP (las monta el integrador en `cmd/server`; cada dueño expone un `http.Handler` o funciones):
  | Ruta | Dueño |
  |---|---|
  | `POST /api/plan` · `GET /api/municipios` · `GET /api/riesgo?horizonte=` | motor (`internal/plan`) |
  | `POST /api/chat` · `GET/POST /webhook/whatsapp` · `POST /webhook/twilio` · `GET /api/cards/plan.png` | bot |
  | `POST /api/alerts/subscribe` · `GET /api/alerts/backtest?municipio=` · `GET /api/alerts/timeline?municipio=&anio=2026` · `GET /api/admin/resumen` · `POST /api/admin/run-alerts?date=` | alertas |
- Cada paquete expone `func Routes(mux *http.ServeMux, deps ...)` o un constructor equivalente; el integrador los conecta.
- **Modo estático** (link que nunca falla): el motor exporta a `web/public/static/` los municipios, el riesgo de los 340 y planes precalculados de Jocotán y Camotán para las combinaciones comunes; las alertas exportan la línea de tiempo 2026 y el backtest. La web usa la API si responde y si no, esos JSON.
- Front: Vue 3 + Vite + TS, Pinia, vue-router, maplibre-gl, gsap, lucide-vue-next, vitest, @playwright/test. Sin otras dependencias pesadas sin anotarlo aquí.

## Modo estático del motor (`web/public/static/`, lo genera `go run ./cmd/export -static`)
- `municipios.json`: `[{id,nombre,departamento,lat,lon,elev_m,pendiente_pct,celda}]` (342). `municipios.geojson`: polígonos (props `id,name,dept`).
- `riesgo_2026.json`, `riesgo_2040-ssp245.json`, `riesgo_2040-ssp585.json`: `[{id,nombre,departamento,riesgo_de_10,riesgo_s2_de_10,riesgo_nino_de_10,deficit_mm,erosion_t_ha,helada_de_10,canicula_dias,siembra_aqui,ranking}]` (= `GET /api/riesgo?horizonte=`).
- `planes/<municipio_id>/<cultivo>-<riego 0|1>-<prioridad>-<horizonte>-<idioma>.json` = `contract.Plan` (= `POST /api/plan`). Jocotán y Camotán: todas las combinaciones (cultivo milpa|maiz|frijol|sorgo × riego × prioridad comida|agua|suelo|ingreso × horizonte 2026|2040-ssp245|2040-ssp585 × es|en). Los otros 340: solo `milpa-0-comida-2026-es.json` y `-en.json`. Supuestos fijos: 1 manzana, sin ganado, mano de obra normal, con semilla; la web escala `total_qq` = `rendimiento_qq_mz × area_manzanas`. Índice: `planes/index.json`.
- `validacion.json` (sequías documentadas + tabla por año, Jocotán y Camotán), `ia_vs_estadistica.json` (Brier, acierto, coeficientes), `cmip6_deltas.json`.
- `otro` como cultivo = `maiz`. Para un combo que no existe en estático: usar el `milpa-0-comida-2026-<idioma>` del municipio y avisar "plan aproximado".
- **integrador → bot, web (14-nov 11:05) · DESAJUSTE `/api/chat`**: web manda `{"sesion","texto","boton","lat","lon","idioma"}`; bot (`internal/channels/web.go`) lee `{"session_id","texto","boton_id","lat","lon","tipo"}`. Con el formato de web el bot pierde la sesión y repite el saludo. Pido a **bot** aceptar ambos nombres (`sesion`|`session_id`, `boton`|`boton_id`, `idioma`) y deducir `tipo=location` si vienen lat/lon. Respuesta (`[]MensajeChat`) ya coincide. `image_url` sale absoluta con `PUBLIC_URL`.

## Integración
- Cada agente hace **commits pequeños y frecuentes** en su rama (español). **Sin push.**
- El **integrador** junta las ramas en `integracion` cada ~2 h (`git merge feat/... construccion-herramienta`), corre todo (`go build ./...`, `go test -p 1 ./...`, build web, e2e) y arregla la unión.
- Para recibir el trabajo de otros: `git merge integracion` en tu rama cuando el integrador marque "integracion OK" aquí abajo.

## Estado
Cada agente escribe `C:\Users\Pc\spaceapps-fieldshift-agentes\estado\<agente>.md`:
```
ESTADO: TRABAJANDO | LISTO | BLOQUEADO
Hecho / Falta / Pedidos / Problemas
Última actualización: <fecha hora>
```

## Cambios al contrato
- **motor 2026-11-14 11:00** (solo agregados): `Estrategia` += `riesgo_de_10, puntajes{comida,agua,suelo,ingreso 0..10}, ingreso_q_mz, postrera_qq_mz, total_qq (para el área), escorrentia_mm, etapa_vulnerable, suelo_mo_p10/p90, anios[]{anio,grano_qq_mz,deficit_mm,perdida,el_nino}`. `Plan` += `siembra_aqui (MM-DD), periodos[] (primera|canicula|postrera|vulnerable|helada), clima_mensual[12]{mes,lluvia_mm(Rango),et0_mm,tmin_c}, enso{oni,trimestre,estado,condicion,anios_nino,riesgo_nino_s0,riesgo_otros_s0}, zona, suelo{arena,arcilla,mo,profundidad_m,fuente}, area_manzanas, falso_inicio_de_10, canicula_dias(Rango), helada_de_10, resumen[4] (líneas para WhatsApp, en el idioma pedido), motor`. Nuevo `Periodo.tipo` = `cobertura` (S2). Textos vienen en `request.idioma` (es|en): pedir el plan otra vez con el otro idioma.
- **motor**: `contracts/fixtures/plan_jocotan.json` ya es **salida REAL del motor** (Jocotán, milpa, 8 cuerdas, prioridad comida, 2026). Regenerar: `go run ./cmd/export -fixture`.

## Pedidos entre agentes
- **web (14-nov)**: el front vive en `web/` con su propio `web/package.json` (Vite, puerto dev 5201; `npm run build` → `web/dist/`). Proxy de dev: `/api` y `/webhook` → `http://127.0.0.1:8080` (cambiar con `VITE_API_TARGET`). Si el server Go usa otro puerto, avisen aquí.
- **web → webdatos (14-nov)**: cada feature se monta sola si existe `web/src/features/<mapa|alertas|how>/index.vue` (export default del componente de la vista; rutas `/map`, `/alerts`, `/how`). Mientras no exista, se ve un marcador. Desde ahí pueden usar: `import { useI18n } from '@/i18n'` → `{ lang, t }` (`lang.value` = `'en'|'es'`; tengan su propio diccionario por `lang`), `import { api } from '@/api/client'` (`api.get<T>(rutaApi, rutaEstatica)`: intenta la API y cae al JSON de `/static/`). Tokens CSS (claro/oscuro con `[data-theme]`): `--bg --bg-2 --surface --surface-2 --ink --ink-2 --ink-3 --line --tierra --hueso --granada --anil --maiz --jade --ok --warn --risk --radius --radius-lg --shadow-1 --shadow-2 --glass --font-display --font-ui --font-mono`. Componentes en `@/components/ui` (FsButton, FsCard, Gauge, Chip, GlassPanel, Skeleton, CountUp, StatusBadge, DataTag, HuipilBand).
- **web → bot (14-nov)**: el simulador llama `POST /api/chat` con `{"sesion":"web-<aleatorio>","texto":"hola","boton":"<id opcional>","lat":14.82,"lon":-89.39,"idioma":"en"}` (todo opcional salvo `sesion`) y espera `[]contract.MensajeChat`. Si eligen otro formato, anótenlo aquí y lo adapto. Para la tarjeta: `GET /api/cards/plan.png?municipio_id=&...` (mismos campos de PlanRequest en query); si falla, la web dibuja la suya en canvas.
- **web → motor (14-nov)**: propuesta de modo estático (si eligen otra, anótenla aquí): `/static/municipios.json` (array de `contract.Municipio`), `/static/plans/index.json` (array de claves) y `/static/plans/<municipio_id>__<cultivo>__<riego 0|1>__<prioridad>__<horizonte>.json` (un `contract.Plan`). La web busca la clave exacta y si no está, la más parecida del mismo municipio y horizonte; si nada, el fixture.
- **integrador → bot, alertas (14-nov)**: variables de entorno con los nombres de `.env.example` (rama `integracion`): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_SANDBOX_CODE`, `LLM_ENABLED`, `ANTHROPIC_API_KEY`, `DB_PATH`, `ADMIN_TOKEN`, `PUBLIC_URL`, `WEB_URL`. Si usan otros, anótenlos aquí. El server ya protege `/api/admin/*` con `ADMIN_TOKEN` (Bearer; sin token, solo localhost).
- **integrador → motor, bot, alertas (14-nov)**: conecto en `cmd/server/wire.go`. Necesito constructores que reciban rutas por parámetro (`DATA_DIR`, `STATIC_DIR`, `DB_PATH`), no rutas fijas relativas, para que Docker funcione. Motor: `plan.Routes(mux)` + un `contract.Planner`. Bot: `bot.Routes(mux, bot.Deps{Planner: ...})` y un `contract.Mensajero` (canal web/simulador como mínimo) para alertas. Alertas: `alerts.Routes(mux, ...)` y `alerts.StartScheduler(ctx, ...)` o un `RunDaily(date string) error` (el server ya trae scheduler 06:00 GT).
- **integrador → web (14-nov)**: el server Go corre en **8200** (local) y `PORT` en la nube. Pido: base de la API en `import.meta.env.VITE_API_BASE` (vacío = mismo origen); en Vercel/Pages `/api` da 404, así que respuesta no-OK **o no-JSON** = caída → `static/`. `base` de Vite configurable (`--base=/repo/` para GitHub Pages) y `static/` relativo a `import.meta.env.BASE_URL`. Para el e2e: `data-testid` en pasos del asistente, tarjetas S0/S1/S2, anillo-calendario, input/botones del simulador; `/demo?rec=1` sin cursor ni controles para grabar el video.

## Integración
- (el integrador anota aquí cada merge y si quedó OK)
- **14-nov ~10:55 · merge 1** (`feat/bot`, `feat/alertas`, `feat/webdatos`; motor y web sin commits nuevos): **ROTO, no mergear todavía**. (a) **alertas**: `internal/forecast/store.go:18` embebe `archivo/*.json.gz` y esa carpeta no está commiteada → falla `go build ./...` (y arrastra `cmd/ingest`). Commiteá `internal/forecast/archivo/`. (b) **motor**: `internal/sim/site.go:77,112` usa `rhCache/wsCache/rsCache` que no existen en `Site` (ya venía roto en `cd0d143`). OK: `cmd/server`, `internal/cards`, `internal/fao56`, `internal/store`. `go.mod/go.sum` unidos (sqlite + gg) con `go mod tidy`.
- **14-nov 11:00 · merge 2** (motor `339abe7`, bot `a5d744c`): `cmd/server` ya monta **motor real** (`plan.Routes(mux, DATA_DIR)`) y **bot real** (`channels.Routes` con el Planner del motor y `eng.Muni`); alertas sigue con falso. `/healthz` dice qué es real. Sigue **ROTO** `go build ./...`: (a) **alertas**: falta commitear `internal/forecast/archivo/` (embed). (b) **bot**: `internal/bot` `TestConversacionCompletaConUbicacion` y `TestEnglishFlow` esperan las fechas del fixture viejo ("15 may al 5 jun"); el motor cambió `contracts/fixtures/plan_jocotan.json` por salida real → que el test no dependa de fechas fijas (o use un fixture propio en `internal/bot/testdata`). OK: cmd/server, cards, channels, fao56, ml, store, valid.
