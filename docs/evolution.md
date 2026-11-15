# WhatsApp con Evolution API

[Evolution API](https://github.com/EvolutionAPI/evolution-api) v2 (open source, Node + Baileys) conecta el bot de Field Shift a un número de WhatsApp normal, vinculado como "dispositivo vinculado". El bot es el mismo de whatsmeow, Meta Cloud y el simulador; solo cambia el canal (`WA_MODO=evolution`).

> ⚠️ **Riesgo:** es un cliente **no oficial** de WhatsApp. WhatsApp puede bloquear el número si detecta uso automatizado. **Usá un número secundario**, nunca el personal. Para producción, lo oficial es WhatsApp Cloud API (Meta, `docs/whatsapp-setup.md`).

## Qué hace

| | |
|---|---|
| **Entrada** | webhook `POST /webhook/evolution?k=<clave>`: texto, respuestas de botones/listas (o el número de la opción, como respaldo), ubicación 📍 y notas de voz (→ `voz.Transcribir` en la GPU si el servicio `tools/stt` está arriba) |
| **Salida** | REST de Evolution: texto, imagen (tarjeta del plan), video MP4 del sandbox, documento PDF (informe), nota de voz OGG (`voz.Hablar`, si la persona pidió AUDIOS) y ubicación |
| **Alertas** | el scheduler (cada 3 h) y **PRUEBA ALERTA** salen por este canal |
| **Vinculación** | QR en PNG (se refresca solo mientras no se vincula) en `/admin/whatsapp?token=…` y en `WA_QR_PNG`; código de 8 caracteres si se da `WA_NUMERO` |
| **Privacidad** | teléfonos enmascarados en los logs (`5025****0101`) |

Botones y listas van como texto ("👉 *Sí* · *No*", listas numeradas): WhatsApp ya no muestra botones a clientes no oficiales. El bot entiende la palabra o el número.

## En esta PC (sin Docker)

Todo oculto, solo en `127.0.0.1` (no hay aviso de firewall; `solo-local.cjs` obliga a Node a escuchar en 127.0.0.1). Carpeta: `%LOCALAPPDATA%\FieldShift\evolution` (o `EVOLUTION_HOME`).

```powershell
# 1) una sola vez (~5 min): PostgreSQL portable + Evolution API 2.3.7 + migraciones
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\instalar.ps1
# 2) cada vez que se prende la PC: PostgreSQL (127.0.0.1:5439) + Evolution (127.0.0.1:8080) + instancia "fieldshift"
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\arrancar.ps1
# 3) el server Go con WA_MODO=evolution (127.0.0.1:8216). Imprime el link de vinculación con el token.
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\servidor.ps1            # con QR
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\servidor.ps1 -Numero 50255551234   # + código de 8
# apagar
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\servidor.ps1 -Detener
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\detener.ps1
```

- La API key de Evolution queda en `apikey.txt` y el token de admin en `admin-token.txt` (en la carpeta de Evolution, nunca en el repo).
- Logs: `logs\evolution.log`, `logs\postgres.log`, `logs\server.log`.
- La sesión de WhatsApp se guarda en PostgreSQL: al reiniciar no hay que volver a escanear.

## Pasos para el dueño (vincular el número)

1. **Arrancar**: los tres comandos de arriba (`arrancar.ps1` y `servidor.ps1`). `servidor.ps1` imprime `http://127.0.0.1:8216/admin/whatsapp?token=…`.
2. **Vincular** con el teléfono del número del bot (secundario):
   - **QR:** abrí el link (o el PNG `estado\muestras\evolution\qr.png`). En el teléfono: **WhatsApp → ⋮ / Configuración → Dispositivos vinculados → Vincular un dispositivo** y escaneá. El QR se renueva solo; la página se actualiza cada 5 s.
   - **Código de 8 caracteres** (sin cámara): arrancá con `servidor.ps1 -Numero 502XXXXXXXX` (código de país + número, solo dígitos). La página muestra el código (p. ej. `ABCD-1234`). En el teléfono: **Dispositivos vinculados → Vincular un dispositivo → Vincular con el número de teléfono** y escribilo.
   - Listo cuando la página dice **✅ Vinculado y conectado**.
3. **Probar** desde **otro** teléfono, escribiéndole al número del bot:
   - `hola` → pide la ubicación; mandá 📎 → Ubicación → elegí cultivo y tamaño → plan, tarjeta, video, informe PDF.
   - `PRUEBA ALERTA` → manda una alerta real por este canal.
   - Una nota de voz (si `tools\stt\arrancar.ps1` está corriendo) → la transcribe y contesta.
4. **Desvincular**: en el teléfono, Dispositivos vinculados → tocá "FieldShift" → Cerrar sesión.

## Variables

| Variable | Qué | Por defecto |
|---|---|---|
| `WA_MODO` | `evolution` enciende este canal | — |
| `EVOLUTION_URL` | REST de Evolution | `http://127.0.0.1:8080` |
| `EVOLUTION_APIKEY` | `AUTHENTICATION_API_KEY` de Evolution | — (obligatoria) |
| `EVOLUTION_INSTANCE` | nombre de la instancia | `fieldshift` |
| `EVOLUTION_WEBHOOK` | URL que Evolution llama (sin `?k=`, se agrega sola) | `http://127.0.0.1:<puerto>/webhook/evolution` |
| `WA_NUMERO` | número para el código de 8 caracteres | — |
| `WA_QR_PNG` | dónde escribir el PNG del QR | junto a `DB_PATH` (`whatsapp-qr.png`) |
| `ADMIN_TOKEN` | protege `/admin/whatsapp` | — (sin token: solo desde la misma PC) |

El server Go, al arrancar, **crea la instancia si no existe y registra el webhook** (eventos `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`, con base64 de los medios). El `?k=` es un hash de la API key: el webhook rechaza (401) cualquier POST sin él.

## En la nube

`deploy/evolution/docker-compose.yml` (Evolution 2.3.7 + PostgreSQL 16, sin Redis):

```bash
EVOLUTION_APIKEY=$(openssl rand -hex 24) docker compose -f deploy/evolution/docker-compose.yml up -d
# server Go: WA_MODO=evolution EVOLUTION_URL=http://<host>:8080 EVOLUTION_APIKEY=… EVOLUTION_WEBHOOK=https://<server-go>/webhook/evolution
```

El puerto 8080 queda en `127.0.0.1`: poné Evolution en la misma red privada que el server Go o detrás de un proxy con TLS.

## Código

- `internal/channels/evolution/` — cliente REST (transporte de `channels.Vinculado`), webhook, vigilancia del estado/QR y página `/admin/whatsapp`.
- `cmd/server/wire.go` — `evolucion(cfg)`: con `WA_MODO=evolution` monta `/webhook/evolution` y la página de vinculación.
- Tests: `go test -p 1 ./internal/channels/evolution/` (Evolution falsa con `httptest`: envíos, instancia, QR/código, webhook de cada tipo de mensaje, LID, punta a punta con el bot y alertas).
- Sin número vinculado, Evolution deja colgados los envíos: el canal corta antes con `ErrNoConectado` y lo loguea (las alertas se reintentan en la próxima corrida).
