# Field Shift · un solo binario Go con el front Vue embebido.
# docker build -t fieldshift . && docker run -p 8080:8080 --env-file .env fieldshift

# 1) Front
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2) Go (modernc.org/sqlite es Go puro: CGO apagado)
FROM golang:1.26-alpine AS go
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist/ ./cmd/server/webdist/
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/fieldshift-server ./cmd/server

# 3) Imagen final mínima
FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=go /out/fieldshift-server /app/fieldshift-server
COPY --from=go /src/data /app/data
COPY --from=go /src/contracts /app/contracts
COPY --from=web /src/web/public/static /app/web/public/static
ENV PORT=8080 \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/web/public/static \
    FIXTURE_PATH=/app/contracts/fixtures/plan_jocotan.json \
    DB_PATH=/var/data/fieldshift.db
EXPOSE 8080
ENTRYPOINT ["/app/fieldshift-server"]
