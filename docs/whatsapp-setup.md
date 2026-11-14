# Conectar el bot a WhatsApp (Meta Cloud API y Twilio Sandbox)

El bot (`internal/bot`) es el mismo para los tres canales. El **simulador web** (`POST /api/chat`) funciona siempre, sin credenciales. Los canales de WhatsApp se encienden solos cuando están sus variables de entorno.

> **Sin cuentas de Meta ni Twilio todavía:** usá el modo **vinculado** (`WA_MODO=vinculado`), ver [`whatsapp-vinculado.md`](whatsapp-vinculado.md). Es para demo y piloto; en producción va Meta Cloud API (abajo).

## Variables de entorno

Nunca en el repo. En local van en un `.env` (ignorado por git); en Render/Fly/Railway, en el panel de secretos.

```env
# Generales
PUBLIC_URL=https://api.tu-dominio.app      # base pública de la API (imágenes para Twilio y firma de Twilio)
WEB_URL=https://tu-web.app                 # base de la web: el bot manda "Ver el plan completo 👉 WEB_URL/plan?..."
BOT_NOMBRE=Field Shift                     # nombre con el que se presenta el bot (pendiente de decidir)
BOT_SESIONES=/var/data/sesiones.json       # archivo de sesiones (por defecto: carpeta temporal)

# WhatsApp Cloud API (Meta)
WHATSAPP_TOKEN=EAAG...                     # token de acceso (temporal 24 h o de usuario de sistema)
WHATSAPP_PHONE_NUMBER_ID=1234567890        # "Phone number ID" del número de prueba
WHATSAPP_APP_SECRET=abcd...                # App secret (Configuración de la app → Básica): firma X-Hub-Signature-256
WHATSAPP_VERIFY_TOKEN=una-frase-larga      # la inventás vos; se pega igual en Meta al configurar el webhook
WHATSAPP_API_VERSION=v21.0                 # opcional

# Twilio WhatsApp Sandbox (respaldo para el jurado)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886 # número del sandbox
# TWILIO_CONTENT_ALERTA_CANICULA=HX...     # opcional: ContentSid por plantilla (fuera de la ventana de 24 h)
```

## Rutas que expone el bot

| Ruta | Para qué |
|---|---|
| `POST /api/chat` | Simulador web. Cuerpo `{"session_id","texto","boton_id","lat","lon","mensaje_id"}` → `[]MensajeChat` |
| `GET /api/chat?session_id=` | Mensajes pendientes del simulador (avisos que mandaron las alertas) |
| `GET /webhook/whatsapp` | Verificación de Meta (`hub.challenge`) |
| `POST /webhook/whatsapp` | Mensajes de Meta (valida `X-Hub-Signature-256`; responde 200 al instante y procesa en segundo plano) |
| `POST /webhook/twilio` | Mensajes de Twilio (valida `X-Twilio-Signature`; responde con TwiML) |
| `GET /api/cards/plan.png?municipio=&cultivo=&riego=&ganado=&prioridad=&horizonte=&idioma=` | Tarjeta PNG 1080×1350 del plan |
| `GET /api/cards/media/<id>.png` | PNG temporales para Twilio |

Integración (la hace el integrador en `cmd/server`):

```go
deps := channels.DepsDesdeEnv()
deps.Planner = planner          // internal/plan (si falta, usa el fixture con "DATOS DE EJEMPLO")
deps.Subs = alertasStore         // implementa bot.Suscripciones (si falta, memoria)
svc := channels.Routes(mux, deps)
alertas.Mensajero = svc.Mensajero // enruta: "web:<id>" → simulador; otro → Cloud o Twilio
```

Demo solo del bot: `go run ./internal/channels/demo -addr 127.0.0.1:8202`.

## 1. Meta: número de prueba (mismo día, sin verificar el negocio)

1. Entrá a <https://developers.facebook.com/apps> → **Crear app** → tipo **Empresa** (Business) → agregá el producto **WhatsApp**.
2. En **WhatsApp → Configuración de la API** (API Setup):
   - Meta te da un **número de prueba** y un **token temporal** (dura 24 h). Copiá el **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID` y el token → `WHATSAPP_TOKEN`.
   - En **Para** (To) agregá hasta **5 teléfonos** del equipo y verificalos con el código que llega por WhatsApp. El número de prueba solo le escribe a esos 5.
3. **App secret**: Configuración de la app → Básica → *Clave secreta de la app* → `WHATSAPP_APP_SECRET`.
4. **Webhook**: WhatsApp → Configuración → Webhook → *Editar*:
   - URL de devolución de llamada: `https://<PUBLIC_URL>/webhook/whatsapp`
   - Token de verificación: el mismo texto que `WHATSAPP_VERIFY_TOKEN`.
   - *Verificar y guardar* (Meta hace el GET; el servidor tiene que estar arriba y con HTTPS).
   - En **Campos del webhook**, suscribite a **messages**.
5. Probá: desde uno de los 5 teléfonos escribile "hola" al número de prueba. Primero hay que **escribirle vos** (abre la ventana de 24 h).
6. **Token que no vence** (para la demo del domingo): Business Settings → Usuarios del sistema → crear uno (admin) → asignarle la app y la cuenta de WhatsApp → *Generar token* con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.

Local sin dominio: `cloudflared tunnel --url http://127.0.0.1:8202` (o ngrok) y usá esa URL https en el paso 4.

### Plantillas (avisos fuera de la ventana de 24 h)

En WhatsApp Manager → Plantillas → crear, categoría **Utility**, idiomas `es` y `en`. Nombres que usan las alertas: `alerta_canicula`, `alerta_lluvia_fuerte`, `ventana_siembra`, `seguimiento_semanal`, `perspectiva_temporada`. Las variables del cuerpo son `{{1}}`, `{{2}}`… en el orden de `Alerta.Vars`. Los textos están en `/submission/whatsapp_templates.md` (integrador/alertas). La aprobación tarda de minutos a horas.

Para `seguimiento_semanal` agregá botones de respuesta rápida con estos **payloads** (el bot los entiende y los guarda):

| Botón | Payload |
|---|---|
| Bien | `seg:bien` |
| Hojas amarillas | `seg:amarillas` |
| Se está secando | `seg:seca` |
| Se perdió | `seg:perdida` |

(Dentro de la ventana de 24 h las alertas pueden mandar botones normales con IDs `seg:<respuesta>:<alerta_id>`.)

## 2. Twilio WhatsApp Sandbox (para que el jurado pruebe con su teléfono)

1. Creá cuenta en <https://www.twilio.com/try-twilio> (prueba gratis).
2. Console → **Messaging → Try it out → Send a WhatsApp message**. Ahí está el número del sandbox (`+1 415 523 8886`) y el código `join <dos-palabras>`.
3. **Sandbox settings** → *When a message comes in*: `https://<PUBLIC_URL>/webhook/twilio`, método **POST**. Guardar.
4. Copiá **Account SID** y **Auth Token** (Console → Account info) a `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`; `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`.
5. Cualquiera se une mandando `join <dos-palabras>` a ese número (mostrar el QR `https://wa.me/14155238886?text=join%20<dos-palabras>` en la web). La unión dura 72 h.
6. `PUBLIC_URL` tiene que ser **exactamente** la URL que Twilio llama (la firma `X-Twilio-Signature` se calcula con ella). Si no coincide, el webhook responde 401.

Límites del sandbox: sin botones ni listas libres (el bot los manda como texto: "👉 *Sí* · *No*" o listas numeradas, y entiende la palabra o el número), cuenta de prueba con saldo limitado y mensajes con prefijo de Twilio. Plantillas fuera de 24 h: solo con Content Templates aprobadas (`TWILIO_CONTENT_<PLANTILLA>=HX...`).

## Comandos del bot

`HOLA` · `MENU` (plan otra vez) · `1` `2` `3` (detalle) · `CAMBIAR` (empezar de nuevo) · `EN` / `ES` · `AYUDA` · `AVISAME` (suscribirse) · `BAJA` / `STOP` (dejar de recibir avisos). Notas de voz: el bot pide el texto con amabilidad (sin transcripción por ahora).

## Privacidad

Los teléfonos salen enmascarados en los logs (`5025****1234`). Se guarda lo mínimo para avisar: teléfono, municipio y punto, cultivo, estrategia, fecha de siembra, idioma y fecha del consentimiento. `BAJA` desactiva al suscriptor.
