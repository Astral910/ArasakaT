# Despliegue paso a paso (links públicos para el jurado)

Tres piezas, de más a menos robusta:

| Pieza | Dónde | Qué da | Depende de |
|---|---|---|---|
| **A. Front estático** | Vercel (o GitHub Pages) | El link que **nunca falla**: landing, guía 3D del sandbox, mapa, plan, /demo. Corre el motor en WebAssembly y usa `web/public/static` (planes, `static/sim`, videos). | Nada (sin backend) |
| **B. Backend Go** | Render (o Fly.io) | API en vivo (cualquier coordenada del mundo), video MP4 y PDF del informe (Chromium + ffmpeg en la imagen), webhook de WhatsApp, alertas diarias. | Cuenta con tarjeta (plan pago para disco y scheduler) |
| **C. Túnel desde la PC** | `deploy\tunel.ps1` | Link `https://*.trycloudflare.com` con todo (B) corriendo en esta PC. Respaldo de emergencia. | La PC encendida |

El front intenta la API primero; si no responde (o no hay `VITE_API_BASE`), cae solo al modo estático. Por eso **A siempre funciona** y B lo mejora.

Orden recomendado: GitHub (5 min) → Vercel (5 min) → Render (15 min) → Meta/Twilio apuntando al backend.

---

## 0. Repo en GitHub
```sh
git checkout main && git merge integracion       # cuando COORDINACION.md diga integración OK
gh repo create fieldshift --public --source . --push
git ls-files | grep -i '\.env'                    # solo debe salir .env.example
```

## A1. Front estático en Vercel (recomendado)
**Cuenta:** vercel.com → *Sign up with GitHub* (plan Hobby, gratis).
1. *Add New → Project* → importar el repo. No tocar nada: `vercel.json` define build (`cd web && npm ci && npm run build`), salida `web/dist`, reescrituras del router (todo lo que no es archivo → `index.html`) y caché de `/assets` y `/static`.
2. *Environment Variables* (todas opcionales, **sin secretos**: quedan visibles en el JS):
   | Variable | Valor | Para qué |
   |---|---|---|
   | `VITE_API_BASE` | `https://fieldshift.onrender.com` | Usar el backend en vivo. Sin ella: modo estático. |
   | `VITE_WA_NUMBER` | `+14155238886` | Número de WhatsApp que muestra la web (sandbox de Twilio por defecto). |
   | `VITE_WA_JOIN` | `join <palabras>` | Código del sandbox de Twilio. |
3. *Deploy*. Abrir en **ventana privada** y recorrer: landing → elegir lugar → guía del sandbox → informe → /demo → mapa.

Por CLI: `npm i -g vercel && vercel --prod --yes`.
Por Actions (opcional): `.github/workflows/vercel.yml` publica en cada push a `main` si existen los *secrets* `VERCEL_TOKEN` (vercel.com → Account Settings → Tokens), `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` (salen en `.vercel/project.json` tras `vercel link`). Sin token el job se salta.

> El build pesa ~90 MB (videos precalculados y planes); entra en Hobby. Vercel sirve `.wasm` como `application/wasm`.

## A2. Alternativa: GitHub Pages
1. Settings → Pages → Source: **GitHub Actions**.
2. (Opcional) Settings → Secrets and variables → Actions → *Variables*: `VITE_API_BASE`, `VITE_WA_NUMBER`, `VITE_WA_JOIN`.
3. Push a `main` → `.github/workflows/pages.yml`: recompila el motor WASM con el Go del repo, build con `--base=/<repo>/`, copia `404.html` (router), lo prueba con `deploy/servir-estatico.mjs` y publica.
URL: `https://<usuario>.github.io/<repo>/`.

> ⚠ Con subruta (`/<repo>/`) el mapa pide `/<repo>/<repo>/static/riesgo_*.json` (doble base en `web/src/features/mapa/cargar.ts`; pedido anotado en COORDINACION.md). Hasta que se arregle, **usar Vercel** (raíz `/`, sin el problema) o un dominio propio en Pages.

## B1. Backend en Render (recomendado)
**Cuenta:** render.com → *Sign up with GitHub* + tarjeta. Plan **Starter** (USD 7/mes): el *free* se duerme y no tiene disco, así el scheduler de las 06:00 y la base de alertas no sobreviven.
1. *New → Blueprint* → el repo. Lee `render.yaml`: servicio Docker (`Dockerfile`), healthcheck `/healthz`, disco de 1 GB en `/var/data` (SQLite, sesiones del bot, caché de video).
2. Completar en el panel las variables `sync: false`:
   | Variable | Valor |
   |---|---|
   | `PUBLIC_URL` | `https://<servicio>.onrender.com` |
   | `WEB_URL` | link de Vercel (o el mismo `PUBLIC_URL`, que también sirve el front embebido) |
   | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET` | Meta (§D) |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_SANDBOX_CODE` | Twilio (§D) |
   `ADMIN_TOKEN` y `WHATSAPP_VERIFY_TOKEN` se generan solos: copiarlos del panel.
3. Video en vivo: Starter (512 MB) trae `SIMVIDEO_RENDER=off` → sirve los videos **precalculados** (`static/video`). Para renderizar cualquier lugar en el servidor, subir a *Standard* (2 GB) y borrar esa variable.
4. Probar: `curl https://<servicio>.onrender.com/healthz` → `{"ok":true,...}` con motor, bot y alertas en "real". Luego poner `VITE_API_BASE` en Vercel y redeploy.

## B2. Alternativa: Fly.io
**Cuenta:** fly.io + tarjeta; instalar `flyctl` (`iwr https://fly.io/install.ps1 -useb | iex`).
```sh
fly launch --no-deploy --copy-config --name fieldshift   # usa fly.toml (región mia, 1 GB de RAM, máquina siempre encendida)
fly volumes create fieldshift_data --size 1 --region mia
fly secrets set PUBLIC_URL=https://fieldshift.fly.dev WEB_URL=https://<vercel> ADMIN_TOKEN=$(openssl rand -hex 16) \
  WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_VERIFY_TOKEN=... WHATSAPP_APP_SECRET=... \
  TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_WHATSAPP_FROM=whatsapp:+14155238886 TWILIO_SANDBOX_CODE="join ..."
fly deploy
```

## B3. La imagen Docker (lo que corre en Render y Fly)
`Dockerfile` multi-etapa: (1) Node 22 compila el front, (2) Go 1.26 compila el servidor con el front embebido (CGO apagado), (3) Debian slim con **Chromium** (video del sandbox e informe PDF vía chromedp), **ffmpeg** (libx264) y fuentes Noto.
- Puerto: `PORT` (las plataformas lo ponen); escucha en `0.0.0.0:$PORT`.
- Datos que cambian en el volumen `/var/data`: `DB_PATH`, `BOT_SESIONES`, `SIMVIDEO_CACHE`, cachés.
- Ya vienen puestas: `CHROME_PATH=/usr/bin/chromium`, `FFMPEG_PATH=/usr/bin/ffmpeg`, `SIMVIDEO_ENCODER=libx264`, `TZ=America/Guatemala`. Chromium corre con `--no-sandbox` (`/etc/chromium.d/zz-contenedor`).
- Ningún secreto en la imagen: todo por variables de entorno (lista completa en `.env.example`).

Prueba local (si hay Docker):
```sh
docker build -t fieldshift .
docker run --rm -p 8080:8080 -v fieldshift-data:/var/data --env-file .env fieldshift
```
En GitHub, `.github/workflows/docker.yml` construye la imagen en cada cambio y comprueba `/healthz`, la web, Chromium, ffmpeg y que el volumen se pueda escribir.

## C. Túnel de respaldo desde esta PC (sin cuenta)
```powershell
powershell -NoProfile -File deploy\tunel.ps1              # compila si hace falta, levanta todo oculto e imprime el link
powershell -NoProfile -File deploy\tunel.ps1 -Detener     # cerrar
powershell -NoProfile -File deploy\tunel.ps1 -Minutos 1   # prueba: levanta, verifica, cierra al minuto
```
- Usa `cloudflared` de `deploy\bin`, del PATH, o lo descarga (release oficial).
- Servidor en `127.0.0.1:8290` (sin aviso de firewall); el túnel sale hacia Cloudflare.
- Pasa la URL del túnel como `PUBLIC_URL`/`WEB_URL`; sirve también como webhook: `<url>/webhook/whatsapp` (Meta) y `<url>/webhook/twilio`.
- Credenciales de WhatsApp: ponerlas en `.env` de la raíz del repo antes de levantarlo.
- Resultado en `deploy\salida\tunel.json`. **La URL cambia cada vez**; la PC tiene que quedar encendida y sin suspender.
- Ignora a propósito `~/.cloudflared/config.yml` (otros túneles con nombre de esta PC no se tocan).

## D. WhatsApp
### Meta WhatsApp Cloud API (canal principal, número de prueba)
1. developers.facebook.com → *Create App* → tipo *Business* → producto **WhatsApp**.
2. *API Setup*: copiar **Phone number ID**, **WhatsApp Business Account ID** y el **token** (el temporal dura 24 h; para la entrega: *System User* con token permanente en Business Settings).
3. Agregar hasta 5 teléfonos del equipo como destinatarios de prueba.
4. *Configuration → Webhook*: URL `https://<backend>/webhook/whatsapp`, *Verify token* = `WHATSAPP_VERIFY_TOKEN`. Suscribir **messages**.
5. *App Settings → Basic*: **App Secret** → `WHATSAPP_APP_SECRET` (valida `X-Hub-Signature-256`).
6. Plantillas de alerta: WhatsApp Manager → *Message templates* → las de `submission/whatsapp_templates.md` (Utility, es y en_US).
Detalle del bot: `docs/whatsapp-setup.md`.

### Twilio WhatsApp Sandbox (para que el jurado escriba desde su teléfono)
1. console.twilio.com → *Messaging → Try it out → Send a WhatsApp message*.
2. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`, código `join <palabras>` → `TWILIO_SANDBOX_CODE` (y `VITE_WA_JOIN` en Vercel).
3. *Sandbox settings → When a message comes in*: `https://<backend>/webhook/twilio` (POST).

## E. Verificación final (ventana privada, sin login)
- [ ] Link de Vercel abre y recorre todo con el backend **apagado** (modo estático): `node deploy/servir-estatico.mjs 5290` + `node deploy/verificar-estatico.mjs http://127.0.0.1:5290/` lo prueba local con capturas.
- [ ] Con backend: `/healthz` dice todo "real"; el sandbox de un lugar fuera de Guatemala responde.
- [ ] WhatsApp real: "hola" → ubicación → plan con tarjeta (captura del teléfono).
- [ ] `POST /api/admin/run-alerts?date=2026-07-03` con `Authorization: Bearer $ADMIN_TOKEN` → llega el aviso de canícula.
- [ ] Si se usa dominio propio: pedir clasificación en FortiGuard (regla de la sede).
