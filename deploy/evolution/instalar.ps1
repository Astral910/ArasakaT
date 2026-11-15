# Instala Evolution API v2 en esta PC, sin Docker y sin avisos de Windows:
#   - PostgreSQL portable (zip oficial de EnterpriseDB, initdb silencioso, solo 127.0.0.1:5439)
#   - Evolution API v2 (Node, Baileys) clonada en $Base\evolution-api, sin Redis (caché local)
# Todo escucha en 127.0.0.1 → no hace falta regla de firewall (no sale el aviso).
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\instalar.ps1
#       [-Base C:\ruta] [-ApiKey clave] [-Version 2.3.7] [-Webhook http://127.0.0.1:8216/webhook/evolution]
# Idempotente: si algo ya está, lo salta. Después: arrancar.ps1.
[CmdletBinding()]
param(
  [string]$Base = $(if ($env:EVOLUTION_HOME) { $env:EVOLUTION_HOME } else { Join-Path $env:LOCALAPPDATA 'FieldShift\evolution' }),
  [string]$ApiKey = $env:EVOLUTION_APIKEY,
  [string]$Version = '2.3.7',
  [string]$PgVersion = '16.4-1',
  [int]$PgPort = 5439,
  [int]$Port = 8080
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force $Base | Out-Null
function Paso($m) { Write-Output "[instalar] $m" }

# ---------- clave de la API (se guarda en $Base\apikey.txt; nunca en el repo) ----------
$keyFile = Join-Path $Base 'apikey.txt'
if (-not $ApiKey) {
  if (Test-Path $keyFile) { $ApiKey = (Get-Content $keyFile -Raw).Trim() }
  else { $ApiKey = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ }) }
}
Set-Content -Path $keyFile -Value $ApiKey -Encoding ascii -NoNewline

# ---------- PostgreSQL portable ----------
$pg = Join-Path $Base 'pgsql'
if (-not (Test-Path (Join-Path $pg 'bin\pg_ctl.exe'))) {
  $zip = Join-Path $Base "postgresql-$PgVersion.zip"
  if (-not (Test-Path $zip)) {
    Paso "bajando PostgreSQL $PgVersion (binarios zip, ~330 MB)…"
    & curl.exe -sSL --retry 3 -o $zip "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64-binaries.zip"
    if ($LASTEXITCODE -ne 0) { throw "no se pudo bajar PostgreSQL" }
  }
  Paso 'descomprimiendo PostgreSQL…'
  & tar.exe -xf $zip -C $Base 'pgsql/bin' 'pgsql/lib' 'pgsql/share'
  if ($LASTEXITCODE -ne 0) { Expand-Archive -Path $zip -DestinationPath $Base -Force }
  Remove-Item $zip -Force
}
$pgData = Join-Path $Base 'pgdata'
if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) {
  Paso 'initdb (usuario postgres, solo local)…'
  $pwFile = Join-Path $Base 'pgpass.tmp'
  Set-Content -Path $pwFile -Value 'evolution' -Encoding ascii -NoNewline
  & (Join-Path $pg 'bin\initdb.exe') -D $pgData -U postgres --pwfile=$pwFile -A scram-sha-256 -E UTF8 --locale=C | Out-Null
  Remove-Item $pwFile -Force
  if ($LASTEXITCODE -ne 0) { throw 'initdb falló' }
  Add-Content (Join-Path $pgData 'postgresql.conf') "`nlisten_addresses = '127.0.0.1'`nport = $PgPort`n"
}

# ---------- Evolution API ----------
$evo = Join-Path $Base 'evolution-api'
if (-not (Test-Path (Join-Path $evo 'package.json'))) {
  Paso "clonando Evolution API $Version…"
  & git -c advice.detachedHead=false clone -q --depth 1 --branch $Version https://github.com/EvolutionAPI/evolution-api.git $evo
  if ($LASTEXITCODE -ne 0) { throw 'git clone falló' }
}
$hook = if ($env:EVOLUTION_WEBHOOK) { $env:EVOLUTION_WEBHOOK } else { 'http://127.0.0.1:8216/webhook/evolution' }
$envTxt = @"
SERVER_TYPE=http
SERVER_PORT=$Port
SERVER_URL=http://127.0.0.1:$Port
CORS_ORIGIN=*
LOG_LEVEL=ERROR,WARN,INFO
LOG_COLOR=false
LOG_BAILEYS=error
DEL_INSTANCE=false
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres:evolution@127.0.0.1:$PgPort/evolution?schema=public
DATABASE_CONNECTION_CLIENT_NAME=fieldshift
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
WEBHOOK_GLOBAL_ENABLED=false
CONFIG_SESSION_PHONE_CLIENT=FieldShift
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30
AUTHENTICATION_API_KEY=$ApiKey
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
TELEMETRY_ENABLED=false
PROVIDER_ENABLED=false
RABBITMQ_ENABLED=false
SQS_ENABLED=false
WEBSOCKET_ENABLED=false
PUSHER_ENABLED=false
S3_ENABLED=false
TYPEBOT_ENABLED=false
CHATWOOT_ENABLED=false
OPENAI_ENABLED=false
DIFY_ENABLED=false
"@
Set-Content -Path (Join-Path $evo '.env') -Value $envTxt -Encoding utf8
Set-Content -Path (Join-Path $Base 'webhook.txt') -Value $hook -Encoding ascii -NoNewline

Push-Location $evo
try {
  if (-not (Test-Path 'node_modules\.bin')) {
    Paso 'npm ci (sin auditoría ni avisos)…'
    & npm.cmd ci --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { & npm.cmd install --no-audit --no-fund --loglevel=error }
    if ($LASTEXITCODE -ne 0) { throw 'npm install falló' }
  }
  Paso 'prisma generate (cliente de PostgreSQL)…'
  $env:DATABASE_PROVIDER = 'postgresql'
  & npx.cmd prisma generate --schema ./prisma/postgresql-schema.prisma | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'prisma generate falló' }
  if (-not (Test-Path 'dist\main.js')) {
    Paso 'compilando (npm run build)…'
    & npm.cmd run build --silent
    if ($LASTEXITCODE -ne 0) { throw 'build falló' }
  }
} finally { Pop-Location }

# Base de datos + migraciones (arranca Postgres oculto si hace falta).
& (Join-Path $PSScriptRoot 'arrancar.ps1') -Base $Base -SoloPostgres
Push-Location $evo
try {
  $env:PGPASSWORD = 'evolution'
  & (Join-Path $pg 'bin\psql.exe') -h 127.0.0.1 -p $PgPort -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='evolution'" | Set-Variable existe
  if (-not $existe) { & (Join-Path $pg 'bin\createdb.exe') -h 127.0.0.1 -p $PgPort -U postgres evolution }
  Paso 'migraciones Prisma…'
  $env:DATABASE_PROVIDER = 'postgresql'
  if (-not (Test-Path 'prisma\migrations')) { Copy-Item -Recurse 'prisma\postgresql-migrations' 'prisma\migrations' }
  & npx.cmd prisma migrate deploy --schema ./prisma/postgresql-schema.prisma
  if ($LASTEXITCODE -ne 0) { throw 'migraciones fallaron' }
} finally { Pop-Location }
Paso "LISTO. Base: $Base · API key en $keyFile · siguiente: deploy\evolution\arrancar.ps1"
