# Encargo: construir la herramienta Field Shift (NASA Space Apps 2026, equipo Guatemala)

Eres el **agente constructor**. Trabajas solo, en segundo plano, autónomo hasta terminar. Repo: `C:\Users\Pc\spaceapps-fieldshift` (rama `construccion-herramienta` ya creada).

## 1. Lee primero (obligatorio, en este orden)
Vault del proyecto: `C:\Users\Pc\SpaceApps2026-Cerebro\`
1. `19 Brief de construccion (prompt para Claude).md` ← **este es el encargo completo; cúmplelo entero**
2. `20 Direccion visual (wow).md` ← cómo debe verse (prioridad #1: que se vea muy lindo)
3. `23 Alertas y seguimiento por WhatsApp.md` ← alertas proactivas y seguimiento (núcleo)
4. `01 Reto Field Shift.md`, `02 Idea del proyecto.md`, `03 Datos NASA.md`, `04 Precision y validacion.md`, `10 Reglas de entrega.md`, `14 Riesgos y que no prometer.md`
5. Lo demás del vault si necesitas contexto (`00 Inicio.md` es el índice).

**No construyas juego ni diorama** (`22 Ideas futuras - el juego.md`): solo deja el motor reutilizable.

## 2. Resumen de lo que entregas
Web en **Go + Vue 3** para quien siembra milpa en Guatemala:
- **WhatsApp**: plan por chat (ubicación → municipio, cultivo, límites, prioridades → tarjeta PNG con calendario y S0/S1/S2) **+ alertas proactivas** (canícula, lluvia fuerte, inicio de lluvias, temporada seca, helada) **+ seguimiento semanal**, todo según la nota 23.
- **Web muy linda**: landing con teléfono vivo, asistente, Mi plan (anillo-calendario, tarjetas, ficha de 5 puntos, suelo a 5 años, 2040), mapa de riesgo y panel del extensionista, **máquina del tiempo 2026**, "How do we know?" y `/demo`.
- **Motor determinista en Go** (FAO-56, Monte Carlo, CMIP6, suelo, IA vs estadística, validación) con datos reales de NASA.
- `/submission` en inglés (textos del portal, guion del video, plantillas de WhatsApp).

## 3. Credenciales (todavía no existen)
- Crea `.env.example` con: `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WA_FROM`, `EARTHDATA_TOKEN`, `LLM_API_KEY` (opcional), `ADMIN_TOKEN`.
- **No te bloquees por falta de credenciales**: todo debe funcionar con el **simulador web** y adaptadores falsos en los tests. IMERG/SMAP sin Earthdata → respaldo con NASA POWER (documentado). Cuando el dueño pase las credenciales, solo se llenan en `.env`.
- Nunca subas secretos al repo; teléfonos enmascarados en los logs.

## 4. Estado (lo vigila el orquestador)
Mantén `ESTADO.md` en la raíz, actualizado en **cada hito** del brief (§11):
```
ESTADO: TRABAJANDO | LISTO | BLOQUEADO
Hito actual: ...
Hecho: ...
Falta: ...
Problemas / decisiones: ...
Última actualización: <fecha hora>
```
Anota las decisiones también en `C:\Users\Pc\SpaceApps2026-Cerebro\17 Bitacora de decisiones.md` y lo que falte en `15 Pendientes.md`.

## 5. Forma de trabajar (axiomas del dueño)
- Español en reportes y commits. Directo.
- Autónomo: no preguntes; decide con el vault y anota.
- **Nada visible**: servidores con `Start-Process -WindowStyle Hidden`; navegadores headless con `args: ['--mute-audio','--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']`; sin sonidos ni ventanas.
- Paralelismo moderado: `go test -p 1`, `vitest --maxWorkers=2`, un solo navegador a la vez.
- Lo pesado de GPU (grabar video con NVENC, transcripción) va en la GPU.
- Servidores locales en `127.0.0.1` (no pidas permisos de firewall).
- Git: commits pequeños en español en `construccion-herramienta`; **sin push**.
- Ahorro: lee por partes, no repitas trabajo, hazlo bien a la primera.
- En `claude -p` la sesión muere al terminar el turno: no termines con esperas en segundo plano; espera en primer plano.

## 6. Listo = verificado
Cumple el §12 del brief: build + tests en verde, Playwright headless con capturas en `/submission/screenshots`, conversación completa en el simulador, alertas probadas con la máquina del tiempo 2026 y la lista del reto marcada. Los fallos se escriben en `ESTADO.md`, no se esconden. Al final pon `ESTADO: LISTO` (o `BLOQUEADO` con el motivo exacto).

Empieza ya.
