package whatsmeow

import (
	"encoding/base64"
	"encoding/json"
	"html/template"
	"net/http"
	"strings"
)

// AdminHandler: /admin/whatsapp (página para vincular: QR, código de 8 letras y estado; se refresca sola),
// /admin/whatsapp/qr.png y /admin/whatsapp/estado.json. Montalo detrás del token de admin.
func (c *Cliente) AdminHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		switch {
		case strings.HasSuffix(r.URL.Path, "/qr.png"):
			png := c.QRPNG(512)
			if png == nil {
				http.Error(w, "sin QR vigente (ya vinculado o generando)", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		case strings.HasSuffix(r.URL.Path, "/estado.json"):
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(c.Estado())
		default:
			e := c.Estado()
			d := struct {
				Estado
				QRData template.URL
			}{Estado: e}
			if png := c.QRPNG(420); png != nil {
				d.QRData = template.URL("data:image/png;base64," + base64.StdEncoding.EncodeToString(png))
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_ = pagina.Execute(w, d)
		}
	})
}

var pagina = template.Must(template.New("wa").Parse(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="{{if .Conectado}}30{{else}}5{{end}}">
<title>Field Shift · WhatsApp vinculado</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1f17;color:#eef6f0;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:460px;padding:28px;text-align:center}
h1{font-size:1.35rem;margin:0 0 6px} p{color:#b9d3c3;line-height:1.45}
.ok{display:inline-block;background:#1f7a4d;color:#fff;border-radius:999px;padding:6px 14px;font-weight:600}
.qr{background:#fff;border-radius:18px;padding:14px;display:inline-block;margin:14px 0}
.qr img{width:300px;height:300px;display:block;image-rendering:pixelated}
.cod{font:700 2rem ui-monospace,Consolas,monospace;letter-spacing:.18em;background:#12382a;border-radius:12px;padding:12px 16px;margin:10px 0}
ol{text-align:left;color:#d7e8dd;line-height:1.6} small{color:#86a593}
</style></head><body><main>
<h1>🌽 Field Shift · WhatsApp vinculado</h1>
{{if .Conectado}}
  <p><span class="ok">✅ Vinculado y conectado</span></p>
  <p>Número: <b>{{.Numero}}</b>. Escribile <b>hola</b> desde otro teléfono; <b>PRUEBA ALERTA</b> manda una alerta real.</p>
{{else if .Vinculado}}
  <p><span class="ok">Vinculado · reconectando…</span></p>
{{else}}
  {{if .QRData}}<div class="qr"><img alt="QR para vincular" src="{{.QRData}}"></div>{{else}}<p>Generando el QR…</p>{{end}}
  {{if .Codigo}}<p>O con el número de teléfono, este código:</p><div class="cod">{{.Codigo}}</div>{{end}}
  <ol>
    <li>En el teléfono del número del bot: <b>WhatsApp → ⋮ / Configuración → Dispositivos vinculados → Vincular un dispositivo</b>.</li>
    <li>Escaneá este QR (se renueva solo cada ~20 s){{if .Codigo}} o tocá <b>Vincular con el número de teléfono</b> y escribí el código{{end}}.</li>
    <li>Listo: esta página dice <b>Vinculado y conectado</b>.</li>
  </ol>
{{end}}
<p><small>{{.Nota}} · actualizado {{.Actualizado.Format "15:04:05"}} · Uso para demo y piloto: en producción va WhatsApp Cloud API (Meta). Usá un número secundario.</small></p>
</main></body></html>`))
