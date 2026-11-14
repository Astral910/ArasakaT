#!/usr/bin/env sh
# Compila el front (web/) y lo embebe en el binario Go (cmd/server/webdist).
# Uso: scripts/build.sh            → bin/fieldshift-server
set -eu
cd "$(dirname "$0")/.."

if [ -f web/package.json ]; then
  (cd web && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build)
  find cmd/server/webdist -mindepth 1 ! -name _placeholder.html -exec rm -rf {} + 2>/dev/null || true
  cp -R web/dist/. cmd/server/webdist/
else
  echo "web/package.json no existe: se embebe la página de reserva" >&2
fi

mkdir -p bin
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o bin/fieldshift-server ./cmd/server
echo "listo: bin/fieldshift-server"
