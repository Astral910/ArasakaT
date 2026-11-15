# Asistente de Field Shift (chat)

Un asistente de extensión agrícola en el **dashboard**, **dentro del simulador** y en **WhatsApp**. Responde corto, en español o inglés, con fuentes, y puede **actuar**: abrir el simulador en un rango de fechas, registrar lo que reporta el agricultor y cambiar la siembra o la capa del 3D.

## Cómo funciona

```
web (ChatFieldShift.vue) ──POST /api/chat/asistente──┐
WhatsApp / simulador del teléfono ── bot (texto libre) ┤
                                                        ▼
                                   internal/chat.Servicio  (cola: 2 a la vez · 90 s · respaldo)
                                                        │  claude -p (oculto, prioridad baja)
                                                        ▼
                         Claude Code CLI ──stdio── cmd/fieldshift-mcp ──POST /api/chat/herramienta (127.0.0.1 + token del turno)
                                │                                                      │
                          WebSearch / WebFetch                              internal/chat.Herramientas
                          (fuentes reales)                                  plan · simular · riego_hoy · registrar_reporte
                                                                            plagas · abrir_simulacion · cambiar_siembra
                                                                            mostrar_filtro · mis_parcelas
```

- **Motor** (`internal/chat/claude.go`): `claude -p <contexto + mensaje> --output-format json --system-prompt <extensionista> --resume <sesión>`, con
  `--tools WebSearch,WebFetch`, `--allowedTools mcp__fieldshift WebSearch WebFetch`, `--mcp-config <json con el token del turno>`, `--strict-mcp-config`,
  `--setting-sources project` y `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`: **sin archivos ni shell**, sin los CLAUDE.md del dueño ni del repo.
  En Windows corre sin ventana y en prioridad *BelowNormal*; si `claude` es el `claude.cmd` de npm se usa el `claude.exe` del paquete (por un `.cmd` los argumentos se rompen).
- **Conversación**: el cliente manda `conversacion` (la web guarda una por navegador; WhatsApp usa un hash del teléfono). El servidor guarda `conversación → session_id` en `<carpeta de DB_PATH>/chat/sesiones.json` y la siguiente pregunta va con `--resume`.
- **Herramientas** (`internal/chat/herramientas.go`): corren **en el servidor**, con el lugar, cultivo y siembra del contexto. El MCP solo hace de puente; cada turno tiene un token aleatorio que vence al terminar la respuesta, y la ruta de herramientas solo acepta `127.0.0.1`.
  - `riego_hoy` y `registrar_reporte` usan `GET /api/parcelas/{id}/hoy` y `POST /api/parcelas/{id}/reportes` de **campo** con la cookie del usuario (o, por WhatsApp, `X-FieldShift-Tel` + `X-FieldShift-Interno: CHAT_SECRETO`). Si campo no está, el chat calcula un **estimado** propio: FAO-56 (Kc × ET0) con el año típico del motor, menos la lluvia que reportó el agricultor ("mucho" ≈ 25 mm, marcado como supuesto). La lluvia y el "mañana" del año típico salen etiquetados como **no observados / no pronóstico**.
  - `plagas`: las de campo; si no, una guía corta por cultivo con fuente (FAO gusano cogollero, CIMMYT Maize Doctor, ICTA) marcada **estimado**.
  - `abrir_simulacion(desde, hasta, siembra…)`: no calcula nada, deja la **acción** para la pantalla. Además, si el mensaje trae un rango ("del 1 de julio al 1 de agosto", "simulá julio", "july 1 to august 15") y el modelo no llamó la herramienta, el servidor agrega la acción igual (red de seguridad, `ParseRango`).
- **Fuentes**: el modelo termina con `Fuentes: … | …`; el servidor la separa del texto y la une con las fuentes que dejaron las herramientas.
- **Respaldo** (`respaldo.go`): sin `claude`, ocupado más de 90 s o con error, responde por reglas con las mismas herramientas (riego de hoy, reporte de lluvia o plaga, rango → simulación) y lo dice (`motor: "respaldo"`).

## API

`POST /api/chat/asistente` (no `/api/chat`: esa sigue siendo el simulador de WhatsApp de la landing)

```json
{ "parcelaId": "p1", "mensaje": "Generame del 1 de julio al 1 de agosto", "conversacion": "web-…",
  "contexto": { "pantalla": "sandbox", "idioma": "es", "municipio_id": "jocotan-chiquimula", "cultivo": "maiz",
                "siembra": "2026-05-20", "area_m2": 437, "riego_mm_semana": 20, "estrategia": "S1", "lat": 14.81, "lon": -89.38 } }
```

→ `{ respuesta, fuentes: [{titulo, url?}], acciones: [{tipo, params}], conversacion, motor: "claude" | "respaldo", ms }`

Acciones: `abrir_simulacion {desde, hasta, siembra?, estrategia?, riego_mm_semana?, url}` (url = `/sandbox?…` con los mismos nombres de parámetro) ·
`registrar_reporte {tipo, valor?, unidad?, texto, fecha, parcelaId?}` · `cambiar_siembra {fecha}` · `mostrar_filtro {filtro: temperatura|humedad|estres|erosion|verdor|null}`.

`GET /api/chat/asistente` → `{disponible, motor, max_paralelo, timeout_s}`. En `/healthz`, `componentes.chat` = `claude:<modelo>` o `respaldo`.

## Web

`web/src/features/chat/ChatFieldShift.vue`: props `parcelaId?`, `contexto?` (ver `tipos.ts`), `flotante` (true: botón abajo a la derecha; false: panel dentro de una tarjeta), `abierto`. Emite `accion` apenas llega la respuesta; si nadie escucha, el botón de la acción "Ver simulación" navega a `/sandbox?…`. Sugerencias: "¿Cuánto riego hoy?", "Simulá julio", "Reportar lluvia". Demo: `/src/features/chat/demo/index.html?lang=es` en el servidor de desarrollo.

## WhatsApp

El texto libre que no es parte del flujo guiado (una frase de 3+ palabras o con "?", después del plan o antes de empezar) va al asistente con el lugar, cultivo, riego y estrategia de la sesión del bot. La respuesta sale corta con "Fuentes: …"; `abrir_simulacion` se traduce en **video de ese rango** (`/api/sim/video.mp4?…&desde=&hasta=`; `internal/simvideo` lo pasa a `/sandbox?rec=1`) + link al simulador. Si el teléfono está vinculado a una cuenta con un solo terreno, la conversación usa ese terreno. Los comandos (MENU, VIDEO, INFORME…), los números 1/2/3 y las respuestas del flujo guiado no pasan por el asistente.

## Configuración

| Variable | Por defecto | Qué |
|---|---|---|
| `CHAT_MOTOR` | (claude) | `off` = solo respaldo por reglas |
| `CHAT_MODELO` | `sonnet` | modelo de Claude Code (`haiku` es más rápido) |
| `CHAT_TIMEOUT_S` | `90` | tiempo límite por pregunta (incluida la cola) |
| `CHAT_MAX` | `2` | preguntas a Claude a la vez |
| `CHAT_CLAUDE_BIN` | `claude` | ruta al CLI |
| `CHAT_MCP_BIN` | junto al servidor o `bin/` | `go build -o bin/fieldshift-mcp ./cmd/fieldshift-mcp`; en desarrollo el servidor lo compila solo si falta |
| `CHAT_SECRETO` | aleatorio | autoriza las llamadas internas a cuentas por teléfono |
| `CHAT_ESFUERZO` | (ninguno) | `low`, `medium` o `high` (opcional) |

Tiempos medidos (sáb 14 nov, Sonnet, Jocotán, servidor local): riego hoy 6.6 s · rango julio–agosto 6.1 s · reporte de lluvia 7.0 s · por WhatsApp 5.7 s · plaga en inglés 12.4 s. Detalle en `estado/muestras/chatbot/`. Pruebas: `go test -p 1 ./internal/chat/` (con un `claude` falso que arranca el MCP de verdad), `scripts/prueba-chat-real.sh` y `scripts/prueba-chat-wa.py` contra un servidor con Claude.

## Producción: API de Anthropic con clave propia

Para la demo del hackathon el cerebro es **Claude Code CLI con la cuenta del dueño** (`claude -p`), porque así lo pidió el equipo y no requiere clave. **En producción no se usa una cuenta personal**: va la **API de Anthropic con una clave propia del proyecto** (`ANTHROPIC_API_KEY` en los secretos del servidor), por términos de uso, cuotas y trazabilidad. El cambio queda dentro de `internal/chat`: otro `chat.Motor` que llame a la Messages API con el mismo prompt de sistema y las mismas herramientas (`chat.Definiciones()` ya viene en formato de herramienta con `inputSchema`; el bucle de tool use llama a `Herramientas.Ejecutar` directo, sin MCP) más la búsqueda web del lado de Anthropic. La cola, el respaldo, las acciones y el componente web no cambian.
