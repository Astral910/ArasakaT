# Arranca PostgreSQL portable + Evolution API v2, ocultos (sin ventanas), solo en 127.0.0.1.
# Crea la instancia "fieldshift" con el webhook al server Go si no existe. Idempotente.
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\arrancar.ps1 [-Base C:\ruta]
#       [-Instancia fieldshift] [-Webhook http://127.0.0.1:8216/webhook/evolution?k=…]
[CmdletBinding()]
param(
  [string]$Base = $(if ($env:EVOLUTION_HOME) { $env:EVOLUTION_HOME } else { Join-Path $env:LOCALAPPDATA 'FieldShift\evolution' }),
  [string]$Instancia = $(if ($env:EVOLUTION_INSTANCE) { $env:EVOLUTION_INSTANCE } else { 'fieldshift' }),
  [string]$Webhook = $env:EVOLUTION_WEBHOOK,
  [int]$PgPort = 5439,
  [int]$Port = 8080,
  [switch]$SoloPostgres
)
$ErrorActionPreference = 'Stop'
function Paso($m) { Write-Output "[arrancar] $m" }
function Escucha($p) { [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }
$pg = Join-Path $Base 'pgsql\bin'
$logs = Join-Path $Base 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
if (-not (Test-Path (Join-Path $pg 'pg_ctl.exe'))) { throw "no está instalado: corré deploy\evolution\instalar.ps1" }

# ---------- PostgreSQL ----------
if (-not (Escucha $PgPort)) {
  Paso "PostgreSQL en 127.0.0.1:$PgPort…"
  Start-Process -WindowStyle Hidden -FilePath (Join-Path $pg 'pg_ctl.exe') `
    -ArgumentList @('start', '-D', "`"$(Join-Path $Base 'pgdata')`"", '-l', "`"$(Join-Path $logs 'postgres.log')`"", '-s') | Out-Null
  for ($i = 0; $i -lt 60 -and -not (Escucha $PgPort); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Escucha $PgPort)) { throw "PostgreSQL no arrancó (ver $logs\postgres.log)" }
}
if ($SoloPostgres) { return }

# ---------- Evolution API ----------
$evo = Join-Path $Base 'evolution-api'
if (-not (Escucha $Port)) {
  Paso "Evolution API en 127.0.0.1:$Port…"
  $node = (Get-Command node.exe).Source
  $p = Start-Process -WindowStyle Hidden -PassThru -FilePath 'powershell.exe' -WorkingDirectory $evo -ArgumentList @(
    '-NoProfile', '-Command',
    "(Get-Process -Id `$PID).PriorityClass='BelowNormal'; & '$node' dist/main.js *> '$(Join-Path $logs 'evolution.log')'")
  Set-Content (Join-Path $Base 'evolution.pid') $p.Id
  for ($i = 0; $i -lt 120 -and -not (Escucha $Port); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Escucha $Port)) { throw "Evolution API no arrancó (ver $logs\evolution.log)" }
}

# ---------- instancia + webhook ----------
$key = (Get-Content (Join-Path $Base 'apikey.txt') -Raw).Trim()
if (-not $Webhook) { $Webhook = (Get-Content (Join-Path $Base 'webhook.txt') -Raw -ErrorAction SilentlyContinue) }
if (-not $Webhook) { $Webhook = 'http://127.0.0.1:8216/webhook/evolution' }
if ($Webhook -notmatch '[?&]k=') { # misma clave que calcula el server Go (evolution.Cliente.Secreto)
  $sha = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes("fieldshift-webhook:$key"))
  $k = (($sha[0..11] | ForEach-Object { $_.ToString('x2') }) -join '')
  $Webhook += $(if ($Webhook.Contains('?')) { '&' } else { '?' }) + "k=$k"
}
$h = @{ apikey = $key }
$api = "http://127.0.0.1:$Port"
$hay = @()
try { $hay = @(Invoke-RestMethod -Headers $h "$api/instance/fetchInstances?instanceName=$Instancia") } catch { } # 404 = no existe
$eventos = @('MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED')
if (-not $hay -or $hay.Count -eq 0) {
  Paso "creando la instancia $Instancia…"
  $body = @{ instanceName = $Instancia; integration = 'WHATSAPP-BAILEYS'; qrcode = $true
    webhook = @{ url = $Webhook; byEvents = $false; base64 = $true; events = $eventos } } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Method Post -Headers $h -ContentType 'application/json' -Body $body "$api/instance/create" | Out-Null
} else {
  $body = @{ webhook = @{ enabled = $true; url = $Webhook; byEvents = $false; base64 = $true; events = $eventos } } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Method Post -Headers $h -ContentType 'application/json' -Body $body "$api/webhook/set/$Instancia" | Out-Null
}
$st = Invoke-RestMethod -Headers $h "$api/instance/connectionState/$Instancia"
Paso "LISTO · instancia $Instancia · estado $($st.instance.state) · webhook $($Webhook -replace '\?k=.*','?k=…')"
