# Compila el front (web/) y lo embebe en el binario Go (cmd/server/webdist).
# Uso: powershell -NoProfile -File scripts\build.ps1   → bin\fieldshift-server.exe
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (Test-Path 'web/package.json') {
    Push-Location web
    if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm ci' } }
    npm run build; if ($LASTEXITCODE) { throw 'npm run build' }
    Pop-Location
    Get-ChildItem cmd/server/webdist -Force | Where-Object Name -ne '_placeholder.html' | Remove-Item -Recurse -Force
    Copy-Item -Recurse -Force web/dist/* cmd/server/webdist/
} else {
    Write-Warning 'web/package.json no existe: se embebe la pagina de reserva'
}

New-Item -ItemType Directory -Force bin | Out-Null
$env:CGO_ENABLED = '0'
go build -trimpath -ldflags '-s -w' -o bin/fieldshift-server.exe ./cmd/server
if ($LASTEXITCODE) { throw 'go build' }
# el asistente (claude -p) llama a las herramientas por este MCP: si queda viejo, faltan herramientas (ej. lluvia_fecha)
go build -trimpath -ldflags '-s -w' -o bin/fieldshift-mcp.exe ./cmd/fieldshift-mcp
if ($LASTEXITCODE) { throw 'go build mcp' }
Write-Output 'listo: bin\fieldshift-server.exe + bin\fieldshift-mcp.exe'
