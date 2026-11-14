# Despliegue paso a paso (para cuando haya cuentas)

Dos piezas:
1. **Front estático** (Vercel o GitHub Pages): el link público que **nunca falla**. Funciona solo con `web/public/static/*.json`, sin backend.
2. **Backend Go** (Render o Fly): bot de WhatsApp (webhook HTTPS), API en vivo y alertas diarias. El front lo usa si responde; si no, cae al modo estático.

Orden recomendado: GitHub → Vercel (5 min) → Render (10 min) → Meta/Twilio apuntando al backend.

---

## 0. Repo público en GitHub
```sh
git checkout main && git merge integracion     # cuando integracion esté OK
gh repo create fieldshift --public --source . --push
```
Verificar que `.env` **no** está en el repo (`git ls-files | grep .env` solo debe mostrar `.env.example`).

## 1. Front estático en Vercel (recomendado)
1. vercel.com → *Add New → Project* → importar el repo.
2. No tocar nada: `vercel.json` ya define build (`cd web && npm ci && npm run build`), salida `web/dist` y reescrituras del router.
3. *Environment Variables* (opcional, cuando exista el backend): `VITE_API_BASE = https://<tu-backend>.onrender.com`. Sin esa variable el sitio usa los JSON estáticos.
4. Deploy. Abrir el link en **ventana privada** y recorrer: landing, asistente, Mi plan, mapa, alertas, How, /demo.

Por CLI: `npm i -g vercel && vercel --prod --yes`.

### Alternativa: GitHub Pages
1. Settings → Pages → Source: **GitHub Actions**.
2. (Opcional) Settings → Variables → `VITE_API_BASE`.
3. Push a `main`: corre `.github/workflows/pages.yml` (build con `--base=/<repo>/`, copia `404.html` para el router).
URL: `https://<usuario>.github.io/<repo>/`.

## 2. Backend en Render
1. render.com → *New → Blueprint* → el repo. Lee `render.yaml`: servicio Docker, healthcheck `/healthz`, disco de 1 GB en `/var/data` (SQLite).
   - El plan **free** se duerme y no tiene disco: el scheduler de las 06:00 no correría. Para la demo sirve; para alertas reales, *Starter*.
2. Completar las variables marcadas `sync: false`:
   - `PUBLIC_URL` = `https://<servicio>.onrender.com`
   - `WEB_URL` = link de Vercel
   - WhatsApp y Twilio (ver §4). `ADMIN_TOKEN` y `WHATSAPP_VERIFY_TOKEN` se generan solos: copiarlos del panel.
3. `CORS_ORIGINS`: dejar `*` o poner el dominio de Vercel.
4. Probar: `curl https://<servicio>.onrender.com/healthz` → `{"ok":true,...}` y ver en `componentes` que motor, bot y alertas dicen "real".

### Alternativa: Fly.io
```sh
fly launch --no-deploy --copy-config
fly volumes create fieldshift_data --size 1
fly secrets set WHATSAPP_TOKEN=... WHATSAPP_APP_SECRET=... ADMIN_TOKEN=$(openssl rand -hex 16) ...
fly deploy
```

### Docker local (prueba)
```sh
docker build -t fieldshift .
docker run --rm -p 8080:8080 -v fieldshift-data:/var/data --env-file .env fieldshift
```

## 3. Túnel para probar el webhook desde la PC (sin nube)
```powershell
Start-Process cloudflared -WindowStyle Hidden -ArgumentList 'tunnel','--url','http://127.0.0.1:8200'
```
La URL `https://*.trycloudflare.com` sale en el log; usarla como URL del webhook (cambia cada vez).

## 4. WhatsApp
### Meta WhatsApp Cloud API (canal principal, número de prueba)
1. developers.facebook.com → *Create App* → tipo *Business* → agregar producto **WhatsApp**.
2. *API Setup*: copiar **Phone number ID**, **WhatsApp Business Account ID** y el **token** (el temporal dura 24 h; para la entrega crear un *System User* con token permanente en Business Settings).
3. Agregar hasta 5 teléfonos del equipo como destinatarios de prueba.
4. *Configuration → Webhook*: URL `https://<backend>/webhook/whatsapp`, *Verify token* = `WHATSAPP_VERIFY_TOKEN`. Suscribir el campo **messages**.
5. *App Settings → Basic*: copiar **App Secret** → `WHATSAPP_APP_SECRET` (valida `X-Hub-Signature-256`).
6. Plantillas de alerta: WhatsApp Manager → *Message templates* → crear las de `submission/whatsapp_templates.md` (categoría Utility, es y en_US).
Detalle del bot: `docs/whatsapp-setup.md` (lo escribe el agente bot).

### Twilio WhatsApp Sandbox (para que el jurado lo pruebe)
1. console.twilio.com → *Messaging → Try it out → Send a WhatsApp message*.
2. Copiar `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, el número del sandbox (`TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`) y el código `join <palabras>` → `TWILIO_SANDBOX_CODE` (la web lo muestra con el QR).
3. *Sandbox settings → When a message comes in*: `https://<backend>/webhook/twilio` (POST).

## 5. Verificación final (ventana privada, sin login)
- [ ] Link de Vercel abre y recorre todo con el backend **apagado** (modo estático).
- [ ] Con backend: el simulador conversa; `/healthz` dice todo "real".
- [ ] WhatsApp real: "hola" → ubicación → plan con tarjeta (captura de pantalla del teléfono).
- [ ] `POST /api/admin/run-alerts?date=2026-07-03` con `Authorization: Bearer $ADMIN_TOKEN` → el aviso de canícula llega al simulador/teléfono.
- [ ] Pedir clasificación del dominio en FortiGuard si se usa dominio propio (regla de la sede).
