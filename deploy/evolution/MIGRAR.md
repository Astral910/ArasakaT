# Migrar el WhatsApp vinculado al servidor final (8300) sin desvincular el número

Hoy: Evolution API en `127.0.0.1:8080`, instancia `fieldshift` (número ya vinculado), webhook →
`fs-evolution-server.exe` en `127.0.0.1:8216`. Meta: que el webhook apunte al servidor final en `127.0.0.1:8300`.

**El número no se toca.** La vinculación vive en Evolution (Postgres + sesión Baileys), no en el servidor Go.
Cambiar el webhook es solo cambiar a dónde Evolution manda los eventos. **Nunca** llamar
`/instance/logout`, `/instance/delete` ni `/instance/restart`, ni borrar `pgdata`: eso sí pide QR nuevo.

## 1. Env del servidor final

Lo lee `cmd/server` (`internal/channels/evolution/evolution.go → ConfigDesdeEnv`, `cmd/server/config.go`):

| Variable | Valor | Para qué |
|---|---|---|
| `WA_MODO` | `evolution` | activa el canal Evolution (sin esto no hay WhatsApp) |
| `EVOLUTION_URL` | `http://127.0.0.1:8080` | REST de Evolution (por defecto ya es esa) |
| `EVOLUTION_APIKEY` | contenido de `%LOCALAPPDATA%\FieldShift\evolution\apikey.txt` | clave de Evolution; **la misma** que usa hoy 8216 |
| `EVOLUTION_INSTANCE` | `fieldshift` | instancia vinculada (por defecto ya es esa) |
| `EVOLUTION_WEBHOOK` | `http://127.0.0.1:8300/webhook/evolution` | sin `?k=`: el servidor la agrega solo |
| `ADMIN_TOKEN` | un token | protege `/admin/whatsapp` (estado/QR) y `/api/admin/*` |
| `ADDR` | `127.0.0.1:8300` (o lo que ya use la demo) | |
| `PUBLIC_URL` | URL pública del túnel | links del bot (informe, sandbox) |
| `WA_QR_PNG` | opcional | dónde dejar el PNG del QR si algún día se desvincula |
| `WA_NUMERO` | **vacío** | solo sirve para pedir código de vinculación; no hace falta |

`EVOLUTION_KEY` no existe: la variable es `EVOLUTION_APIKEY`.

La clave del webhook (`?k=`) **sale de la API key**: `k = hex(sha256("fieldshift-webhook:" + APIKEY))[:24]`.
Con la misma `EVOLUTION_APIKEY`, 8216 y 8300 usan la misma `k`.

**Al arrancar, el servidor final ya registra su webhook solo** (`Asegurar` → `POST /webhook/set/fieldshift`), y si
Evolution dice `open` no pide QR. O sea: arrancar 8300 con este env alcanza. El paso 2 es para hacerlo a mano o
comprobarlo.

## 2. Apuntar el webhook a mano (PowerShell, con `curl.exe`)

```powershell
$base = Join-Path $env:LOCALAPPDATA 'FieldShift\evolution'
$key  = (Get-Content (Join-Path $base 'apikey.txt') -Raw).Trim()
$sha  = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes("fieldshift-webhook:$key"))
$k    = (-join ($sha | ForEach-Object { $_.ToString('x2') })).Substring(0, 24)

# a) estado antes de tocar nada: tiene que decir "open"
curl.exe -s -H "apikey: $key" http://127.0.0.1:8080/instance/connectionState/fieldshift

# b) el webhook actual (debería mostrar 8216)
curl.exe -s -H "apikey: $key" http://127.0.0.1:8080/webhook/find/fieldshift

# c) apuntarlo al servidor final (mismos eventos y base64 que registra el servidor Go)
$body = @{ webhook = @{ enabled = $true; url = "http://127.0.0.1:8300/webhook/evolution?k=$k"; byEvents = $false;
          base64 = $true; events = @('MESSAGES_UPSERT','CONNECTION_UPDATE','QRCODE_UPDATED') } } | ConvertTo-Json -Depth 4
$body | Set-Content -Encoding ascii "$env:TEMP\webhook.json"
curl.exe -s -X POST -H "apikey: $key" -H "Content-Type: application/json" --data "@$env:TEMP\webhook.json" `
  http://127.0.0.1:8080/webhook/set/fieldshift

# d) comprobar: url con 8300 y el estado sigue "open"
curl.exe -s -H "apikey: $key" http://127.0.0.1:8080/webhook/find/fieldshift
curl.exe -s -H "apikey: $key" http://127.0.0.1:8080/instance/connectionState/fieldshift
```

Equivalente en bash:

```bash
KEY=$(tr -d '\r\n' < "$LOCALAPPDATA/FieldShift/evolution/apikey.txt")
K=$(printf 'fieldshift-webhook:%s' "$KEY" | sha256sum | cut -c1-24)
curl -s -X POST -H "apikey: $KEY" -H 'Content-Type: application/json' http://127.0.0.1:8080/webhook/set/fieldshift \
  -d '{"webhook":{"enabled":true,"url":"http://127.0.0.1:8300/webhook/evolution?k='"$K"'","byEvents":false,"base64":true,"events":["MESSAGES_UPSERT","CONNECTION_UPDATE","QRCODE_UPDATED"]}}'
```

## 3. Orden recomendado

1. Arrancar el servidor final con el env del paso 1 (oculto, como siempre). En su log tiene que aparecer
   `evolution: instancia "fieldshift" · webhook http://127.0.0.1:8300/webhook/evolution` y `✅ vinculado y conectado`.
2. Comprobar con 2b/2d que el webhook dice 8300 (si no, correr 2c).
3. Mandar «hola» al número desde otro teléfono: el log de 8300 muestra `POST /webhook/evolution 200` y `vinculado: ← …`.
4. **Recién entonces detener 8216** (`deploy\evolution\servidor.ps1 -Detener`). Con los dos prendidos, los dos
   mandan alertas programadas por el mismo número. No detener Evolution (8080) ni su Postgres.
5. `http://127.0.0.1:8300/admin/whatsapp?token=<ADMIN_TOKEN>` debe decir vinculado.

## Volver atrás

Correr 2c con `8216` en la URL (o reiniciar `servidor.ps1`, que vuelve a registrar su webhook). El número sigue vinculado.

## Notas

- Las sesiones del bot y las suscripciones a alertas viven en la base de cada servidor (`DB_PATH`, `BOT_SESIONES`):
  quien ya habló con 8216 empieza de cero en 8300 salvo que el servidor final use la misma base.
- Si Evolution queda en `close` (se desvinculó por otro motivo), el servidor final pide QR solo y lo muestra en
  `/admin/whatsapp`; se escanea desde *WhatsApp → Dispositivos vinculados*.
