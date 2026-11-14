# Túnel de respaldo desde esta PC: servidor Field Shift oculto en 127.0.0.1 + Cloudflare quick tunnel (sin cuenta).
# Imprime el link público https://*.trycloudflare.com (cambia cada vez que se levanta).
#
#   powershell -NoProfile -File deploy\tunel.ps1                 # levanta y deja corriendo
#   powershell -NoProfile -File deploy\tunel.ps1 -Minutos 1      # prueba: levanta, verifica, espera 1 min y cierra
#   powershell -NoProfile -File deploy\tunel.ps1 -Detener        # cierra lo que quedó corriendo
#   -Puerto 8290   -Compilar (recompila front + servidor)
#
# Todo oculto, prioridad baja. Escucha solo en 127.0.0.1 (sin aviso del firewall): cloudflared sale hacia afuera.
# Resultado en deploy\salida\tunel.json (url, pids, verificación).
param(
  [int]$Puerto = 8290,
  [double]$Minutos = 0,
  [switch]$Compilar,
  [switch]$Detener
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$raiz = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $PSScriptRoot 'bin'
$salida = Join-Path $PSScriptRoot 'salida'
New-Item -ItemType Directory -Force $bin, $salida | Out-Null
$estadoArchivo = Join-Path $salida 'tunel.json'

function Detener-Todo {
  if (Test-Path $estadoArchivo) {
    $e = Get-Content $estadoArchivo -Raw | ConvertFrom-Json
    foreach ($id in @($e.pid_servidor, $e.pid_cloudflared)) {
      if ($id) { try { Stop-Process -Id $id -Force -ErrorAction Stop; "detenido pid $id" } catch {} }
    }
  }
}
if ($Detener) { Detener-Todo; return }

# 1) cloudflared: deploy\bin, PATH, o se descarga (release oficial de Cloudflare en GitHub).
$cf = Join-Path $bin 'cloudflared.exe'
if (-not (Test-Path $cf)) {
  $enPath = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($enPath) { $cf = $enPath.Source }
  else {
    Write-Host 'descargando cloudflared...'
    Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cf
  }
}

# 2) Servidor (binario Go con el front embebido).
$exe = Join-Path $bin 'fieldshift-server.exe'
if ($Compilar -or -not (Test-Path $exe)) {
  Write-Host 'compilando front y servidor...'
  Push-Location (Join-Path $raiz 'web')
  if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund | Out-Null }
  npm run build | Out-Null
  Pop-Location
  $webdist = Join-Path $raiz 'cmd\server\webdist'
  Get-ChildItem $webdist -Exclude '_placeholder.html' | Remove-Item -Recurse -Force
  Copy-Item (Join-Path $raiz 'web\dist\*') $webdist -Recurse -Force
  Push-Location $raiz
  $env:CGO_ENABLED = '0'
  go build -trimpath -ldflags '-s -w' -o $exe ./cmd/server
  Pop-Location
  if (-not (Test-Path $exe)) { throw 'no compiló el servidor' }
}

Detener-Todo | Out-Null

# 3) Túnel primero (para saber la URL pública y pasársela al servidor como PUBLIC_URL/WEB_URL).
$logCf = Join-Path $salida 'cloudflared.log'
Remove-Item $logCf -ErrorAction SilentlyContinue
# Config vacía a propósito: si existe ~/.cloudflared/config.yml (otro túnel con nombre), cloudflared toma su
# ingress y credenciales y el quick tunnel responde 404. Así queda aislado y no toca ese túnel.
$cfgVacia = Join-Path $salida 'cloudflared-vacio.yml'
Set-Content -Encoding ascii $cfgVacia '# quick tunnel de Field Shift: sin ingress ni credenciales'
$pcf = Start-Process $cf -WindowStyle Hidden -PassThru -RedirectStandardError $logCf -RedirectStandardOutput (Join-Path $salida 'cloudflared.out') `
  -ArgumentList 'tunnel', '--config', "`"$cfgVacia`"", '--no-autoupdate', '--url', "http://127.0.0.1:$Puerto"
try { $pcf.PriorityClass = 'BelowNormal' } catch {}
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep 1
  if (Test-Path $logCf) {
    $m = Select-String -Path $logCf -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
  if ($pcf.HasExited) { break }
}
if (-not $url) { Stop-Process -Id $pcf.Id -Force -ErrorAction SilentlyContinue; throw "cloudflared no dio URL (ver $logCf)" }

# 4) Servidor oculto en 127.0.0.1.
$env:ADDR = "127.0.0.1:$Puerto"
$env:PUBLIC_URL = $url
$env:WEB_URL = $url
if (-not $env:DB_PATH) { $env:DB_PATH = Join-Path $salida 'fieldshift.db' }
$psrv = Start-Process $exe -WindowStyle Hidden -PassThru -WorkingDirectory $raiz `
  -RedirectStandardOutput (Join-Path $salida 'servidor.log') -RedirectStandardError (Join-Path $salida 'servidor.err')
try { $psrv.PriorityClass = 'BelowNormal' } catch {}

# 5) Verificación: local y a través del link público.
function Probar([string]$u) {
  for ($i = 0; $i -lt 30; $i++) {
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 $u; return [int]$r.StatusCode } catch { Start-Sleep 2 }
  }
  return 0
}
$local = Probar "http://127.0.0.1:$Puerto/healthz"
$publico = Probar "$url/healthz"
$sandbox = Probar "$url/sandbox?lat=14.79&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=2&unidad=manzana&riego=0&auto=1"

$estado = [ordered]@{
  url = $url; sandbox = "$url/sandbox?lat=14.79&lon=-89.39&lugar=Jocot%C3%A1n&pais=GT&cultivo=milpa&area=2&unidad=manzana&riego=0&auto=1"
  webhook_meta = "$url/webhook/whatsapp"; webhook_twilio = "$url/webhook/twilio"
  pid_servidor = $psrv.Id; pid_cloudflared = $pcf.Id
  healthz_local = $local; healthz_publico = $publico; sandbox_publico = $sandbox
  hora = (Get-Date).ToString('s')
}
$estado | ConvertTo-Json | Set-Content -Encoding utf8 $estadoArchivo
Write-Host ''
Write-Host "LINK PÚBLICO: $url"
Write-Host "  healthz local=$local publico=$publico · sandbox=$sandbox"
Write-Host "  webhook WhatsApp (Meta): $url/webhook/whatsapp · Twilio: $url/webhook/twilio"
Write-Host "  cerrar: powershell -NoProfile -File deploy\tunel.ps1 -Detener"

if ($Minutos -gt 0) {
  Start-Sleep -Seconds ([int]($Minutos * 60))
  $estado.healthz_publico_al_cerrar = Probar "$url/healthz"
  $estado | ConvertTo-Json | Set-Content -Encoding utf8 $estadoArchivo
  Detener-Todo | Out-Null
  Write-Host "prueba terminada: healthz al cerrar=$($estado.healthz_publico_al_cerrar); túnel y servidor cerrados"
}
