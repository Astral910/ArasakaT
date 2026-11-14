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
- (vacío)

## Pedidos entre agentes
- (vacío)

## Integración
- (el integrador anota aquí cada merge y si quedó OK)
