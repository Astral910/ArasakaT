# Detiene Evolution API y PostgreSQL portable (la sesión de WhatsApp queda guardada en la base).
[CmdletBinding()]
param(
  [string]$Base = $(if ($env:EVOLUTION_HOME) { $env:EVOLUTION_HOME } else { Join-Path $env:LOCALAPPDATA 'FieldShift\evolution' }),
  [int]$Port = 8080
)
$ErrorActionPreference = 'SilentlyContinue'
$c = Get-NetTCPConnection -State Listen -LocalPort $Port
foreach ($x in $c) {
  $p = Get-Process -Id $x.OwningProcess
  if ($p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force -Confirm:$false; Write-Output "[detener] Evolution API (pid $($p.Id))" }
}
$pidf = Join-Path $Base 'evolution.pid'
if (Test-Path $pidf) { Stop-Process -Id ([int](Get-Content $pidf)) -Force -Confirm:$false; Remove-Item $pidf }
$pg = Join-Path $Base 'pgsql\bin\pg_ctl.exe'
if (Test-Path $pg) {
  & $pg stop -D (Join-Path $Base 'pgdata') -m fast -s 2>$null
  Write-Output '[detener] PostgreSQL'
}
