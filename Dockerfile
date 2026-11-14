# Field Shift · un solo binario Go con el front Vue embebido + Chromium y ffmpeg
# (video del sandbox e informe PDF se renderizan en el servidor).
#   docker build -t fieldshift .
#   docker run --rm -p 8080:8080 -v fieldshift-data:/var/data --env-file .env fieldshift
# Puerto: PORT (Render/Fly lo ponen solos). Datos que cambian (SQLite, sesiones, cachés): volumen en /var/data.

# 1) Front (Vue + Vite). public/ ya trae static/, wasm/ y geo/: van dentro de dist/.
FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2) Go (modernc.org/sqlite es Go puro: CGO apagado, binario estático)
FROM golang:1.26-bookworm AS go
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist/ ./cmd/server/webdist/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w" -o /out/fieldshift-server ./cmd/server

# 3) Imagen final: Debian slim + Chromium (chromedp) + ffmpeg (libx264) + fuentes con tildes y emoji
# El contenedor no tiene sandbox de usuario: Chromium headless necesita --no-sandbox
# (el wrapper /usr/bin/chromium de Debian lee /etc/chromium.d/*; la comilla simple es a propósito).
FROM debian:bookworm-slim
# hadolint ignore=DL3008,SC2016
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tzdata chromium ffmpeg \
      fonts-noto-core fonts-noto-color-emoji fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && printf 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox --disable-dev-shm-usage"\n' > /etc/chromium.d/zz-contenedor \
 && mkdir -p /var/data
WORKDIR /app
COPY --from=go /out/fieldshift-server /app/fieldshift-server
COPY --from=go /src/data /app/data
COPY --from=go /src/contracts /app/contracts
COPY --from=web /src/web/public/static /app/web/public/static
ENV PORT=8080 \
    TZ=America/Guatemala \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/web/public/static \
    FIXTURE_PATH=/app/contracts/fixtures/plan_jocotan.json \
    DB_PATH=/var/data/fieldshift.db \
    BOT_SESIONES=/var/data/sesiones.json \
    SIMVIDEO_CACHE=/var/data/video \
    SIMVIDEO_ENCODER=libx264 \
    CHROME_PATH=/usr/bin/chromium \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    XDG_CACHE_HOME=/var/data/cache
# Sin USER: los volúmenes de Fly y los discos de Render montan como root y SQLite tiene que escribir ahí.
VOLUME ["/var/data"]
EXPOSE 8080
ENTRYPOINT ["/app/fieldshift-server"]
