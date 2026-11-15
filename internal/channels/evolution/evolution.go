// Package evolution: WhatsApp por Evolution API v2 (open source, Node/Baileys, https://doc.evolution-api.com).
// Es un transporte más para channels.Vinculado (mismo bot que whatsmeow, Cloud y el simulador):
//   - salida por su REST: texto, imagen, video, documento PDF, nota de voz OGG y ubicación;
//   - entrada por webhook POST /webhook/evolution (messages.upsert, connection.update, qrcode.updated);
//   - vinculación: QR (PNG en disco + /admin/whatsapp) o código de 8 caracteres si se da el número.
//
// Variables: WA_MODO=evolution, EVOLUTION_URL, EVOLUTION_APIKEY, EVOLUTION_INSTANCE (fieldshift),
// EVOLUTION_WEBHOOK (URL que Evolution llama; por defecto http://127.0.0.1:8216/webhook/evolution),
// WA_NUMERO (código de 8 caracteres), WA_QR_PNG (dónde dejar el QR). Ver docs/evolution.md.
package evolution

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/bot"

	qrcode "github.com/skip2/go-qrcode"
)

// Config del cliente.
type Config struct {
	URL       string // EVOLUTION_URL (http://127.0.0.1:8080)
	APIKey    string // EVOLUTION_APIKEY (AUTHENTICATION_API_KEY de Evolution)
	Instancia string // EVOLUTION_INSTANCE (fieldshift)
	Webhook   string // URL del webhook del server Go (sin ?k=; se agrega sola)
	Numero    string // WA_NUMERO: pedir código de vinculación de 8 caracteres en vez de solo QR
	QRPath    string // PNG del QR mientras no esté vinculado (se borra al vincular)
	HTTP      *http.Client
	Cada      time.Duration // cada cuánto revisa el estado (10 s)
}

// ConfigDesdeEnv lee las variables EVOLUTION_* y WA_NUMERO.
func ConfigDesdeEnv() Config {
	c := Config{
		URL:       os.Getenv("EVOLUTION_URL"),
		APIKey:    os.Getenv("EVOLUTION_APIKEY"),
		Instancia: os.Getenv("EVOLUTION_INSTANCE"),
		Webhook:   os.Getenv("EVOLUTION_WEBHOOK"),
		Numero:    os.Getenv("WA_NUMERO"),
		QRPath:    os.Getenv("WA_QR_PNG"),
	}
	if c.URL == "" {
		c.URL = "http://127.0.0.1:8080"
	}
	if c.Instancia == "" {
		c.Instancia = "fieldshift"
	}
	return c
}

// Estado de la vinculación (/admin/whatsapp/estado.json). Mismos campos que el de whatsmeow.
type Estado struct {
	Vinculado   bool      `json:"vinculado"`
	Conectado   bool      `json:"conectado"`
	Numero      string    `json:"numero,omitempty"` // enmascarado
	QR          bool      `json:"qr"`
	Codigo      string    `json:"codigo,omitempty"` // código de 8 caracteres vigente
	Nota        string    `json:"nota,omitempty"`
	Actualizado time.Time `json:"actualizado"`
}

// Mensaje entrante ya traducido para el bot.
type Mensaje struct {
	ID      string
	Entrada bot.Entrada
}

// Cliente: transporte de channels.Vinculado sobre Evolution API.
type Cliente struct {
	Cfg       Config
	OnMensaje func(Mensaje)

	mu     sync.Mutex
	est    Estado
	qr     string // texto del QR (2@…) vigente
	qrPNG  []byte // PNG que manda Evolution (o el nuestro)
	cancel context.CancelFunc
}

// Nuevo arma el cliente (no llama a la red).
func Nuevo(cfg Config) (*Cliente, error) {
	if cfg.URL == "" || cfg.APIKey == "" {
		return nil, errors.New("evolution: faltan EVOLUTION_URL o EVOLUTION_APIKEY")
	}
	if cfg.Instancia == "" {
		cfg.Instancia = "fieldshift"
	}
	if cfg.HTTP == nil {
		cfg.HTTP = &http.Client{Timeout: 2 * time.Minute}
	}
	if cfg.Cada <= 0 {
		cfg.Cada = 10 * time.Second
	}
	cfg.URL = strings.TrimRight(cfg.URL, "/")
	cfg.Numero = soloDigitos(cfg.Numero)
	return &Cliente{Cfg: cfg, est: Estado{Nota: "conectando con Evolution API…", Actualizado: time.Now()}}, nil
}

// Secreto: valor de ?k= del webhook (derivado de la API key; Evolution lo repite en cada llamada).
func (c *Cliente) Secreto() string {
	h := sha256.Sum256([]byte("fieldshift-webhook:" + c.Cfg.APIKey))
	return hex.EncodeToString(h[:12])
}

// WebhookURL: la URL completa que se registra en la instancia.
func (c *Cliente) WebhookURL() string {
	w := c.Cfg.Webhook
	if w == "" {
		w = "http://127.0.0.1:8216/webhook/evolution"
	}
	sep := "?"
	if strings.Contains(w, "?") {
		sep = "&"
	}
	return w + sep + "k=" + c.Secreto()
}

// ---------- REST ----------

// ErrHTTP: respuesta no 2xx de Evolution.
type ErrHTTP struct {
	Status int
	Cuerpo string
}

func (e *ErrHTTP) Error() string { return fmt.Sprintf("evolution: HTTP %d: %s", e.Status, e.Cuerpo) }

func (c *Cliente) llamar(ctx context.Context, metodo, ruta string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, metodo, c.Cfg.URL+ruta, body)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.Cfg.APIKey)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.Cfg.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode/100 != 2 {
		s := string(b)
		if len(s) > 300 {
			s = s[:300]
		}
		return &ErrHTTP{Status: res.StatusCode, Cuerpo: s}
	}
	if out != nil && len(b) > 0 {
		return json.Unmarshal(b, out)
	}
	return nil
}

// ErrNoConectado: sin número vinculado Evolution deja colgado el envío; se corta antes (las alertas se reintentan).
var ErrNoConectado = errors.New("evolution: WhatsApp sin vincular o desconectado")

func (c *Cliente) enviar(ruta string, in any) error {
	if !c.Conectado() {
		return ErrNoConectado
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	return c.llamar(ctx, "POST", "/message/"+ruta+"/"+url.PathEscape(c.Cfg.Instancia), in, nil)
}

// numero: Evolution acepta dígitos (5025…) o un JID completo (…@lid).
func numero(tel string) string {
	if strings.Contains(tel, "@") {
		return tel
	}
	return soloDigitos(tel)
}

func (c *Cliente) EnviarTexto(tel, texto string) error {
	return c.enviar("sendText", map[string]any{"number": numero(tel), "text": texto})
}

func (c *Cliente) media(tel, tipo, mime, nombre, caption string, data []byte) error {
	m := map[string]any{"number": numero(tel), "mediatype": tipo, "mimetype": mime,
		"media": base64.StdEncoding.EncodeToString(data), "caption": caption}
	if nombre != "" {
		m["fileName"] = nombre
	}
	return c.enviar("sendMedia", m)
}

func (c *Cliente) EnviarImagen(tel string, png []byte, caption string) error {
	return c.media(tel, "image", "image/png", "plan.png", caption, png)
}

func (c *Cliente) EnviarVideo(tel string, mp4 []byte, caption string) error {
	return c.media(tel, "video", "video/mp4", "fieldshift.mp4", caption, mp4)
}

func (c *Cliente) EnviarDocumento(tel string, data []byte, nombre, mime, caption string) error {
	if nombre == "" {
		nombre = "informe.pdf"
	}
	return c.media(tel, "document", mime, nombre, caption, data)
}

// EnviarNota: nota de voz (PTT) desde OGG/Opus de voz.Hablar.
func (c *Cliente) EnviarNota(tel string, ogg []byte) error {
	return c.enviar("sendWhatsAppAudio", map[string]any{"number": numero(tel),
		"audio": base64.StdEncoding.EncodeToString(ogg), "encoding": true})
}

// EnviarUbicacion: pin con nombre y dirección (p. ej. la parcela o la estación más cercana).
func (c *Cliente) EnviarUbicacion(tel string, lat, lon float64, nombre, direccion string) error {
	return c.enviar("sendLocation", map[string]any{"number": numero(tel), "latitude": lat, "longitude": lon,
		"name": nombre, "address": direccion})
}

// Conectado: la instancia está "open".
func (c *Cliente) Conectado() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.est.Conectado
}

// ---------- instancia, QR y estado ----------

var eventos = []string{"MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"}

// Asegurar crea la instancia si no existe y (re)registra el webhook. Idempotente.
func (c *Cliente) Asegurar(ctx context.Context) error {
	var lista []map[string]any
	err := c.llamar(ctx, "GET", "/instance/fetchInstances?instanceName="+url.QueryEscape(c.Cfg.Instancia), nil, &lista)
	var eh *ErrHTTP
	if err != nil && !(errors.As(err, &eh) && eh.Status == 404) {
		return err
	}
	if len(lista) == 0 {
		in := map[string]any{"instanceName": c.Cfg.Instancia, "integration": "WHATSAPP-BAILEYS", "qrcode": true,
			"webhook": map[string]any{"url": c.WebhookURL(), "byEvents": false, "base64": true, "events": eventos}}
		if err := c.llamar(ctx, "POST", "/instance/create", in, nil); err != nil {
			return fmt.Errorf("crear instancia: %w", err)
		}
		log.Printf("evolution: instancia %q creada", c.Cfg.Instancia)
		return nil
	}
	in := map[string]any{"webhook": map[string]any{"enabled": true, "url": c.WebhookURL(), "byEvents": false,
		"base64": true, "events": eventos}}
	if err := c.llamar(ctx, "POST", "/webhook/set/"+url.PathEscape(c.Cfg.Instancia), in, nil); err != nil {
		return fmt.Errorf("webhook: %w", err)
	}
	return nil
}

// Conectar pide QR (y código de 8 caracteres si hay número).
func (c *Cliente) Conectar(ctx context.Context) error {
	ruta := "/instance/connect/" + url.PathEscape(c.Cfg.Instancia)
	if c.Cfg.Numero != "" {
		ruta += "?number=" + c.Cfg.Numero
	}
	var r qrResp
	if err := c.llamar(ctx, "GET", ruta, nil, &r); err != nil {
		return err
	}
	if r.Instance.State == "open" {
		c.setConectado(true, "")
		return nil
	}
	c.setQR(r.Code, r.Base64, r.PairingCode)
	return nil
}

type qrResp struct {
	PairingCode string `json:"pairingCode"`
	Code        string `json:"code"`
	Base64      string `json:"base64"`
	Instance    struct {
		State string `json:"state"`
	} `json:"instance"`
}

// Revisar: estado de la conexión; si está cerrada, pide QR de nuevo.
func (c *Cliente) Revisar(ctx context.Context) error {
	var r struct {
		Instance struct {
			State string `json:"state"`
		} `json:"instance"`
	}
	if err := c.llamar(ctx, "GET", "/instance/connectionState/"+url.PathEscape(c.Cfg.Instancia), nil, &r); err != nil {
		return err
	}
	switch r.Instance.State {
	case "open":
		if !c.Conectado() {
			c.numeroPropio(ctx)
		}
		c.setConectado(true, "")
	case "connecting":
		c.mu.Lock()
		sinQR := c.qr == "" && c.qrPNG == nil
		c.mu.Unlock()
		if sinQR {
			return c.Conectar(ctx)
		}
	default: // close (o QRCODE_LIMIT agotado): QR nuevo
		c.setConectado(false, "esperando que escanees el QR")
		return c.Conectar(ctx)
	}
	return nil
}

// numeroPropio: el número vinculado (enmascarado) para la página.
func (c *Cliente) numeroPropio(ctx context.Context) {
	var lista []struct {
		OwnerJid string `json:"ownerJid"`
		Owner    string `json:"owner"`
	}
	if err := c.llamar(ctx, "GET", "/instance/fetchInstances?instanceName="+url.QueryEscape(c.Cfg.Instancia), nil, &lista); err != nil || len(lista) == 0 {
		return
	}
	j := lista[0].OwnerJid
	if j == "" {
		j = lista[0].Owner
	}
	if n := telDeJID(j); n != "" {
		c.mu.Lock()
		c.est.Numero = bot.Enmascarar(n)
		c.mu.Unlock()
	}
}

// Iniciar: asegura la instancia y vigila el estado en segundo plano (QR refrescado mientras no se vincule).
func (c *Cliente) Iniciar(ctx context.Context) {
	ctx, c.cancel = context.WithCancel(ctx)
	go func() {
		listo := false
		for {
			cx, cancel := context.WithTimeout(ctx, 30*time.Second)
			var err error
			if !listo {
				if err = c.Asegurar(cx); err == nil {
					listo = true
					log.Printf("evolution: instancia %q · webhook %s", c.Cfg.Instancia, strings.SplitN(c.WebhookURL(), "?", 2)[0])
				}
			}
			if err == nil {
				err = c.Revisar(cx)
			}
			cancel()
			if err != nil {
				c.set(func(e *Estado) {
					e.Conectado = false
					e.Nota = "Evolution API no responde: " + recorte(err.Error(), 120)
				})
				log.Printf("evolution: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(c.Cfg.Cada):
			}
		}
	}()
}

// Cerrar detiene la vigilancia (la sesión sigue en Evolution).
func (c *Cliente) Cerrar() {
	if c.cancel != nil {
		c.cancel()
	}
}

// Estado actual.
func (c *Cliente) Estado() Estado {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.est
	e.QR = c.qr != "" || c.qrPNG != nil
	return e
}

// QRPNG: el QR vigente como PNG (nil si no hay).
func (c *Cliente) QRPNG(px int) []byte {
	c.mu.Lock()
	code, png := c.qr, c.qrPNG
	c.mu.Unlock()
	if code != "" {
		if b, err := qrcode.Encode(code, qrcode.Medium, px); err == nil {
			return b
		}
	}
	return png
}

func (c *Cliente) set(f func(*Estado)) {
	c.mu.Lock()
	f(&c.est)
	c.est.Actualizado = time.Now()
	c.mu.Unlock()
}

func (c *Cliente) setConectado(ok bool, nota string) {
	c.mu.Lock()
	antes := c.est.Conectado
	c.est.Conectado, c.est.Actualizado = ok, time.Now()
	if ok {
		c.est.Vinculado, c.est.Codigo, c.est.Nota = true, "", "conectado"
		c.qr, c.qrPNG = "", nil
	} else if nota != "" {
		c.est.Nota = nota
	}
	path := c.Cfg.QRPath
	c.mu.Unlock()
	if ok && !antes {
		log.Printf("evolution: ✅ vinculado y conectado")
		if path != "" {
			_ = os.Remove(path)
		}
	}
}

// setQR guarda el QR nuevo (texto o PNG base64) y lo escribe en disco.
func (c *Cliente) setQR(code, b64png, pairing string) {
	var png []byte
	if i := strings.Index(b64png, "base64,"); i >= 0 {
		b64png = b64png[i+len("base64,"):]
	}
	if b64png != "" {
		png, _ = base64.StdEncoding.DecodeString(b64png)
	}
	if code == "" && png == nil && pairing == "" {
		return
	}
	c.mu.Lock()
	if code != "" || png != nil {
		c.qr, c.qrPNG = code, png
	}
	if pairing != "" {
		c.est.Codigo = formatoCodigo(pairing)
	}
	c.est.Conectado, c.est.Vinculado, c.est.Numero = false, false, "" // hay QR → la sesión no está vinculada
	c.est.Nota, c.est.Actualizado = "esperando que escanees el QR", time.Now()
	path := c.Cfg.QRPath
	c.mu.Unlock()
	if path != "" {
		if b := c.QRPNG(512); b != nil {
			_ = os.MkdirAll(filepath.Dir(path), 0o755)
			tmp := path + ".tmp"
			if os.WriteFile(tmp, b, 0o644) == nil {
				_ = os.Rename(tmp, path)
			}
		}
	}
}

// formatoCodigo: "ABCD1234" → "ABCD-1234" (como lo muestra WhatsApp).
func formatoCodigo(s string) string {
	s = strings.ToUpper(strings.ReplaceAll(s, "-", ""))
	if len(s) == 8 {
		return s[:4] + "-" + s[4:]
	}
	return s
}

func soloDigitos(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// telDeJID: "50255551234:12@s.whatsapp.net" → "50255551234"; "…@lid" → "" (no es un teléfono).
func telDeJID(j string) string {
	u, srv, _ := strings.Cut(j, "@")
	if srv == "lid" || srv == "g.us" || srv == "broadcast" {
		return ""
	}
	u, _, _ = strings.Cut(u, ":")
	return soloDigitos(u)
}

func recorte(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
