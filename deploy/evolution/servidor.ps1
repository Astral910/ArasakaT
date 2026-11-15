# Arranca el server Go de Field Shift (oculto, 127.0.0.1) con WhatsApp por Evolution API.
# Requiere arrancar.ps1 antes (Evolution en 127.0.0.1:8080). Compila cmd/server si hace falta.
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File deploy\evolution\servidor.ps1
#       [-Puerto 8216] [-Numero 50255551234] [-QR C:\ruta\qr.png] [-Token <ADMIN_TOKEN>] [-Detener]
[CmdletBinding()]
param(
  [string]$Base = $(if ($env:EVOLUTION_HOME) { $env:EVOLUTION_HOME } else { Join-Path $env:LOCALAPPDATA 'FieldShift\evolution' }),
  [int]$Puerto = 8216,
  [string]$Numero = $env:WA_NUMERO,
  [string]$QR = 'C:\Users\Pc\spaceapps-fieldshift-agentes\estado\muestras\evolution\qr.png',
  [string]$Token = $env:ADMIN_TOKEN,
  [switch]$Detener
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exe = Join-Path $Base 'fs-evolution-server.exe'
foreach ($x in @(Get-NetTCPConnection -State Listen -LocalPort $Puerto -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $x.OwningProcess -Force -Confirm:$false -ErrorAction SilentlyContinue
}
if ($Detener) { Write-Output "[servidor] detenido"; return }

Push-Location $repo
try { & go build -o $exe ./cmd/server; if ($LASTEXITCODE -ne 0) { throw 'go build falló' } } finally { Pop-Location }

$tokFile = Join-Path $Base 'admin-token.txt'
if (-not $Token) {
  if (Test-Path $tokFile) { $Token = (Get-Content $tokFile -Raw).Trim() }
  else { $Token = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ }) }
}
Set-Content -Path $tokFile -Value $Token -Encoding ascii -NoNewline
$logs = Join-Path $Base 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$vars = @{
  ADDR = "127.0.0.1:$Puerto"; PUBLIC_URL = "http://127.0.0.1:$Puerto"; ADMIN_TOKEN = $Token
  WA_MODO = 'evolution'; EVOLUTION_URL = 'http://127.0.0.1:8080'; EVOLUTION_INSTANCE = 'fieldshift'
  EVOLUTION_APIKEY = (Get-Content (Join-Path $Base 'apikey.txt') -Raw).Trim()
  EVOLUTION_WEBHOOK = "http://127.0.0.1:$Puerto/webhook/evolution"
  WA_QR_PNG = $QR; WA_NUMERO = $Numero; DB_PATH = (Join-Path $Base 'fieldshift.db')
}
$set = ($vars.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value)'" }) -join '; '
Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -WorkingDirectory $repo -ArgumentList @(
  '-NoProfile', '-Command', "(Get-Process -Id `$PID).PriorityClass='BelowNormal'; $set; & '$exe' *> '$(Join-Path $logs 'server.log')'") | Out-Null
for ($i = 0; $i -lt 60 -and -not (Get-NetTCPConnection -State Listen -LocalPort $Puerto -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
Write-Output "[servidor] http://127.0.0.1:$Puerto · vincular: http://127.0.0.1:$Puerto/admin/whatsapp?token=$Token · QR: $QR"
