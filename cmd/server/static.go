package main

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// webdist lo llena el build (scripts/build: copia web/dist aquí). En el repo solo hay un index de reserva.
//
//go:embed all:webdist
var webEmbed embed.FS

// frontFS devuelve el front: WEB_DIR en disco si existe; si no, el embebido.
func frontFS(cfg Config) fs.FS {
	if cfg.WebDir != "" {
		if st, err := os.Stat(cfg.WebDir); err == nil && st.IsDir() {
			return os.DirFS(cfg.WebDir)
		}
	}
	sub, _ := fs.Sub(webEmbed, "webdist")
	return sub
}

// spaHandler sirve archivos estáticos y, para rutas del router de Vue, index.html.
func spaHandler(fsys fs.FS) http.Handler {
	files := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" || p == "." {
			p = "index.html"
		}
		if st, err := fs.Stat(fsys, p); err == nil && !st.IsDir() {
			if strings.HasPrefix(p, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		// Archivo con extensión que no existe → 404 real (no index.html).
		if p != "index.html" && path.Ext(p) != "" {
			http.NotFound(w, r)
			return
		}
		b, err := fs.ReadFile(fsys, "index.html")
		if err != nil {
			if b, err = fs.ReadFile(fsys, "_placeholder.html"); err != nil {
				http.Error(w, "front no compilado", http.StatusNotFound)
				return
			}
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(b)
	})
}
