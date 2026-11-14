// Package whatsmeow: WhatsApp "vinculado" (dispositivo vinculado a un número real con go.mau.fi/whatsmeow).
// Conexión saliente por websocket: sin webhook, sin túnel, sin cuenta de Meta. Es para demo y piloto: en
// producción va WhatsApp Cloud API (internal/channels/whatsapp_cloud.go). Ver docs/whatsapp-vinculado.md.
//
// La sesión se guarda en SQLite (modernc, foreign_keys). Se vincula por QR (PNG en disco y en /admin/whatsapp)
// o por código de 8 letras (PairPhone, con WA_NUMERO). Reconexión automática. Teléfonos enmascarados en logs.
package whatsmeow

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
	wm "go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
	_ "modernc.org/sqlite"

	"fieldshift/internal/bot"
)

// Config del canal vinculado (variables WA_*).
type Config struct {
	DBPath string // WA_DB: SQLite de la sesión (por defecto junto a DB_PATH: whatsapp.db)
	Numero string // WA_NUMERO: número del teléfono a vincular (solo dígitos con código de país) → código de 8 letras
	QRPath string // WA_QR_PNG: dónde se escribe el QR (PNG) mientras no está vinculado
	Nombre string // nombre del dispositivo en "Dispositivos vinculados" (Chrome (Windows) por defecto)
	Debug  bool   // WA_DEBUG=1: logs de whatsmeow en INFO (pueden traer JIDs: no usar en público)
}

// Estado público (para /admin/whatsapp y /healthz). Nunca lleva el número completo.
type Estado struct {
	Vinculado   bool      `json:"vinculado"`
	Conectado   bool      `json:"conectado"`
	Numero      string    `json:"numero,omitempty"` // enmascarado
	QR          bool      `json:"qr"`               // hay un QR vigente para escanear
	Codigo      string    `json:"codigo,omitempty"` // código de 8 letras (PairPhone) vigente
	Nota        string    `json:"nota,omitempty"`
	Actualizado time.Time `json:"actualizado"`
}

// Mensaje entrante ya traducido para el bot.
type Mensaje struct {
	ID      string
	Entrada bot.Entrada
}

// Cliente: la sesión vinculada.
type Cliente struct {
	Cfg Config
	// OnMensaje recibe cada mensaje entrante de una persona (no grupos, no estados, no los propios).
	OnMensaje func(Mensaje)

	cont *sqlstore.Container
	db   *sql.DB
	cli  *wm.Client
	log  waLog.Logger

	mu     sync.Mutex
	estado Estado
	qr     string // contenido del QR vigente
	cancel context.CancelFunc
}

// Nuevo abre (o crea) la base de la sesión. No conecta: eso lo hace Iniciar.
func Nuevo(cfg Config) (*Cliente, error) {
	if cfg.DBPath == "" {
		cfg.DBPath = "whatsapp.db"
	}
	if cfg.Nombre == "" {
		cfg.Nombre = "Chrome (Windows)"
	}
	cfg.Numero = soloDigitos(cfg.Numero)
	if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.ToSlash(cfg.DBPath) + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	nivel := "WARN"
	if cfg.Debug {
		nivel = "INFO"
	}
	lg := waLog.Stdout("whatsapp", nivel, false)
	cont := sqlstore.NewWithDB(db, "sqlite3", lg.Sub("db"))
	if err := cont.Upgrade(context.Background()); err != nil {
		db.Close()
		return nil, fmt.Errorf("whatsapp: base de la sesión: %w", err)
	}
	store.DeviceProps.Os = proto.String("Field Shift")
	return &Cliente{Cfg: cfg, cont: cont, db: db, log: lg, estado: Estado{Actualizado: time.Now()}}, nil
}

// Iniciar conecta en segundo plano: si ya hay sesión, reconecta (y sigue reconectando solo); si no, arranca la
// vinculación (QR y, con WA_NUMERO, código de 8 letras) y la repite hasta que el dueño escanee.
func (c *Cliente) Iniciar(ctx context.Context) {
	ctx, c.cancel = context.WithCancel(ctx)
	go c.bucle(ctx)
}

func (c *Cliente) bucle(ctx context.Context) {
	espera := 5 * time.Second
	for ctx.Err() == nil {
		err := c.conectar(ctx)
		if err == nil {
			return // conectado: la reconexión la hace whatsmeow (EnableAutoReconnect)
		}
		c.nota(err.Error())
		log.Printf("whatsapp: %v (reintento en %s)", err, espera)
		select {
		case <-ctx.Done():
			return
		case <-time.After(espera):
		}
		if espera < 2*time.Minute {
			espera *= 2
		}
	}
}

// conectar: una vuelta. Vuelve nil cuando queda conectado con sesión; error si hay que reintentar.
func (c *Cliente) conectar(ctx context.Context) error {
	dev, err := c.cont.GetFirstDevice(ctx)
	if err != nil {
		return fmt.Errorf("dispositivo: %w", err)
	}
	cli := wm.NewClient(dev, c.log.Sub("cliente"))
	cli.EnableAutoReconnect = true
	cli.AutoTrustIdentity = true
	cli.AddEventHandler(c.evento)
	c.mu.Lock()
	c.cli = cli
	c.mu.Unlock()

	if cli.Store.ID != nil {
		if err := cli.Connect(); err != nil {
			return fmt.Errorf("conectar: %w", err)
		}
		c.set(func(e *Estado) {
			e.Vinculado, e.Numero, e.QR, e.Codigo = true, bot.Enmascarar(cli.Store.ID.User), false, ""
		})
		log.Printf("whatsapp: sesión vinculada %s, conectando", bot.Enmascarar(cli.Store.ID.User))
		return nil
	}

	// Sin sesión: vinculación.
	qrs, err := cli.GetQRChannel(ctx)
	if err != nil {
		return fmt.Errorf("canal QR: %w", err)
	}
	if err := cli.Connect(); err != nil {
		return fmt.Errorf("conectar: %w", err)
	}
	primero := true
	for it := range qrs {
		switch it.Event {
		case wm.QRChannelEventCode:
			c.ponerQR(it.Code)
			if primero && c.Cfg.Numero != "" {
				primero = false
				go c.pedirCodigo(ctx, cli)
			}
		case "success":
			c.borrarQR()
			c.set(func(e *Estado) { e.Vinculado, e.QR, e.Codigo, e.Nota = true, false, "", "vinculado ✅" })
			if cli.Store.ID != nil {
				c.set(func(e *Estado) { e.Numero = bot.Enmascarar(cli.Store.ID.User) })
			}
			log.Printf("whatsapp: vinculado ✅")
			return nil
		case wm.QRChannelEventError:
			cli.Disconnect()
			return fmt.Errorf("vinculación: %v", it.Error)
		default: // timeout, err-client-outdated, …
			cli.Disconnect()
			c.borrarQR()
			return fmt.Errorf("vinculación: %s (se genera un QR nuevo)", it.Event)
		}
	}
	cli.Disconnect()
	return errors.New("vinculación: canal QR cerrado")
}

// pedirCodigo: código de 8 letras para "Vincular con el número de teléfono".
func (c *Cliente) pedirCodigo(ctx context.Context, cli *wm.Client) {
	cod, err := cli.PairPhone(ctx, c.Cfg.Numero, true, wm.PairClientChrome, c.Cfg.Nombre)
	if err != nil {
		log.Printf("whatsapp: código de vinculación: %v", err)
		c.nota("código de vinculación: " + err.Error())
		return
	}
	c.set(func(e *Estado) { e.Codigo = cod })
	log.Printf("whatsapp: código de vinculación para %s: %s (WhatsApp → Dispositivos vinculados → Vincular con número)", bot.Enmascarar(c.Cfg.Numero), cod)
	if c.Cfg.QRPath != "" {
		_ = os.WriteFile(strings.TrimSuffix(c.Cfg.QRPath, filepath.Ext(c.Cfg.QRPath))+"-codigo.txt", []byte(cod+"\n"), 0o644)
	}
}

func (c *Cliente) ponerQR(code string) {
	c.mu.Lock()
	c.qr = code
	c.mu.Unlock()
	c.set(func(e *Estado) { e.QR, e.Nota = true, "esperando que escanees el QR" })
	if c.Cfg.QRPath == "" {
		return
	}
	if png, err := qrcode.Encode(code, qrcode.Medium, 512); err == nil {
		_ = os.MkdirAll(filepath.Dir(c.Cfg.QRPath), 0o755)
		if err := os.WriteFile(c.Cfg.QRPath, png, 0o644); err == nil {
			log.Printf("whatsapp: QR nuevo en %s (vence en ~20 s; se renueva solo)", c.Cfg.QRPath)
		}
	}
}

func (c *Cliente) borrarQR() {
	c.mu.Lock()
	c.qr = ""
	c.mu.Unlock()
	c.set(func(e *Estado) { e.QR = false })
	if c.Cfg.QRPath != "" {
		_ = os.Remove(c.Cfg.QRPath)
	}
}

// QRPNG: el QR vigente como PNG (nil si no hay).
func (c *Cliente) QRPNG(px int) []byte {
	c.mu.Lock()
	code := c.qr
	c.mu.Unlock()
	if code == "" {
		return nil
	}
	png, err := qrcode.Encode(code, qrcode.Medium, px)
	if err != nil {
		return nil
	}
	return png
}

func (c *Cliente) set(f func(*Estado)) {
	c.mu.Lock()
	f(&c.estado)
	c.estado.Actualizado = time.Now()
	c.mu.Unlock()
}

func (c *Cliente) nota(s string) { c.set(func(e *Estado) { e.Nota = s }) }

// Estado actual.
func (c *Cliente) Estado() Estado {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.estado
	if c.cli != nil {
		e.Conectado = c.cli.IsConnected() && c.cli.IsLoggedIn()
	}
	return e
}

// Conectado: listo para mandar.
func (c *Cliente) Conectado() bool { return c.Estado().Conectado }

// Cerrar desconecta (la sesión queda guardada).
func (c *Cliente) Cerrar() {
	if c.cancel != nil {
		c.cancel()
	}
	c.mu.Lock()
	cli := c.cli
	c.mu.Unlock()
	if cli != nil {
		cli.Disconnect()
	}
	c.db.Close()
}

// ---------- eventos ----------

func (c *Cliente) evento(raw any) {
	switch ev := raw.(type) {
	case *events.Message:
		c.recibir(ev)
	case *events.Connected:
		c.set(func(e *Estado) { e.Nota = "conectado" })
		log.Printf("whatsapp: conectado")
		// "disponible" para que lleguen bien los acuses y el teléfono muestre el dispositivo activo
		if cli := c.cliente(); cli != nil {
			_ = cli.SendPresence(context.Background(), types.PresenceAvailable)
		}
	case *events.Disconnected:
		c.set(func(e *Estado) { e.Nota = "desconectado (reconectando…)" })
		log.Printf("whatsapp: desconectado, reconectando")
	case *events.LoggedOut:
		// El dueño quitó el dispositivo desde el teléfono: se borra la sesión y se vuelve a pedir QR.
		log.Printf("whatsapp: sesión cerrada desde el teléfono (%v) → vincular de nuevo", ev.Reason)
		c.set(func(e *Estado) {
			e.Vinculado, e.Numero, e.Nota = false, "", "sesión cerrada desde el teléfono: vinculá de nuevo"
		})
		go func() {
			if cli := c.cliente(); cli != nil {
				cli.Disconnect()
				_ = cli.Store.Delete(context.Background())
			}
			c.bucle(context.Background())
		}()
	case *events.StreamReplaced:
		c.nota("otra instancia abrió esta misma sesión")
		log.Printf("whatsapp: otra instancia abrió esta sesión (¿dos servidores con la misma WA_DB?)")
	}
}

func (c *Cliente) cliente() *wm.Client {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cli
}

func (c *Cliente) recibir(ev *events.Message) {
	if ev.Info.IsFromMe || ev.Info.IsGroup || ev.Info.Chat.Server == types.BroadcastServer || ev.Info.Chat.Server == types.NewsletterServer {
		return
	}
	tel := c.telefonoDe(ev.Info.MessageSource)
	if tel == "" {
		log.Printf("whatsapp: mensaje sin teléfono resoluble (%s), ignorado", ev.Info.Sender.Server)
		return
	}
	e, ok := EntradaDe(ev.Message)
	if !ok {
		return // reacciones, acuses, protocolo…
	}
	e.Tel = tel
	if cli := c.cliente(); cli != nil {
		_ = cli.MarkRead(context.Background(), []types.MessageID{ev.Info.ID}, ev.Info.Timestamp, ev.Info.Chat, ev.Info.Sender)
	}
	if c.OnMensaje != nil {
		c.OnMensaje(Mensaje{ID: ev.Info.ID, Entrada: e})
	}
}

// telefonoDe: el número (solo dígitos) de quien escribe; con direcciones LID, se resuelve al número.
func (c *Cliente) telefonoDe(ms types.MessageSource) string {
	for _, j := range []types.JID{ms.Sender, ms.SenderAlt, ms.Chat} {
		if j.Server == types.DefaultUserServer && j.User != "" {
			return j.User
		}
	}
	if cli := c.cliente(); cli != nil && ms.Sender.Server == types.HiddenUserServer {
		if pn, err := cli.Store.LIDs.GetPNForLID(context.Background(), ms.Sender); err == nil && pn.User != "" {
			return pn.User
		}
	}
	return ""
}

// EntradaDe traduce un mensaje de WhatsApp a la entrada del bot: texto, respuesta de botón/lista, ubicación 📍,
// nota de voz o imagen. ok=false para lo que no es un mensaje de la persona (reacciones, protocolo).
func EntradaDe(m *waE2E.Message) (bot.Entrada, bool) {
	if m == nil {
		return bot.Entrada{}, false
	}
	switch {
	case m.GetConversation() != "":
		return bot.Entrada{Tipo: "text", Texto: m.GetConversation()}, true
	case m.GetExtendedTextMessage().GetText() != "":
		return bot.Entrada{Tipo: "text", Texto: m.GetExtendedTextMessage().GetText()}, true
	case m.GetLocationMessage() != nil:
		lm := m.GetLocationMessage()
		lat, lon := lm.GetDegreesLatitude(), lm.GetDegreesLongitude()
		return bot.Entrada{Tipo: "location", Lat: &lat, Lon: &lon}, true
	case m.GetLiveLocationMessage() != nil:
		lm := m.GetLiveLocationMessage()
		lat, lon := lm.GetDegreesLatitude(), lm.GetDegreesLongitude()
		return bot.Entrada{Tipo: "location", Lat: &lat, Lon: &lon}, true
	case m.GetButtonsResponseMessage() != nil:
		r := m.GetButtonsResponseMessage()
		return bot.Entrada{Tipo: "interactive", BotonID: r.GetSelectedButtonID(), Texto: r.GetSelectedDisplayText()}, true
	case m.GetListResponseMessage() != nil:
		r := m.GetListResponseMessage()
		return bot.Entrada{Tipo: "interactive", BotonID: r.GetSingleSelectReply().GetSelectedRowID(), Texto: r.GetTitle()}, true
	case m.GetTemplateButtonReplyMessage() != nil:
		r := m.GetTemplateButtonReplyMessage()
		return bot.Entrada{Tipo: "interactive", BotonID: r.GetSelectedID(), Texto: r.GetSelectedDisplayText()}, true
	case m.GetAudioMessage() != nil:
		return bot.Entrada{Tipo: "audio"}, true
	case m.GetImageMessage() != nil:
		return bot.Entrada{Tipo: "image", Texto: m.GetImageMessage().GetCaption()}, true
	case m.GetDocumentMessage() != nil, m.GetVideoMessage() != nil, m.GetStickerMessage() != nil, m.GetContactMessage() != nil:
		return bot.Entrada{Tipo: "otro"}, true
	}
	return bot.Entrada{}, false
}

// ---------- envío ----------

var ErrNoConectado = errors.New("whatsapp vinculado: sin conexión")

func (c *Cliente) destino(tel string) (*wm.Client, types.JID, error) {
	cli := c.cliente()
	if cli == nil || !cli.IsConnected() || !cli.IsLoggedIn() {
		return nil, types.JID{}, ErrNoConectado
	}
	d := soloDigitos(tel)
	if len(d) < 8 {
		return nil, types.JID{}, fmt.Errorf("whatsapp vinculado: teléfono inválido %s", bot.Enmascarar(tel))
	}
	return cli, types.NewJID(d, types.DefaultUserServer), nil
}

func (c *Cliente) mandar(tel string, m *waE2E.Message) error {
	cli, to, err := c.destino(tel)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	_, err = cli.SendMessage(ctx, to, m)
	return err
}

// EnviarTexto manda texto (WhatsApp permite hasta 65 536 caracteres; se recorta a 4096 como Cloud API).
func (c *Cliente) EnviarTexto(tel, texto string) error {
	return c.mandar(tel, &waE2E.Message{Conversation: proto.String(recortar(texto, 4096))})
}

func (c *Cliente) subir(data []byte, tipo wm.MediaType) (wm.UploadResponse, error) {
	cli := c.cliente()
	if cli == nil {
		return wm.UploadResponse{}, ErrNoConectado
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	return cli.Upload(ctx, data, tipo)
}

// EnviarImagen: PNG con pie de foto.
func (c *Cliente) EnviarImagen(tel string, png []byte, caption string) error {
	if _, _, err := c.destino(tel); err != nil {
		return err
	}
	up, err := c.subir(png, wm.MediaImage)
	if err != nil {
		return err
	}
	return c.mandar(tel, &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
		Caption: proto.String(recortar(caption, 1024)), Mimetype: proto.String("image/png"),
		URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
	}})
}

// EnviarVideo: MP4 (H.264) con pie.
func (c *Cliente) EnviarVideo(tel string, mp4 []byte, caption string) error {
	if _, _, err := c.destino(tel); err != nil {
		return err
	}
	up, err := c.subir(mp4, wm.MediaVideo)
	if err != nil {
		return err
	}
	return c.mandar(tel, &waE2E.Message{VideoMessage: &waE2E.VideoMessage{
		Caption: proto.String(recortar(caption, 1024)), Mimetype: proto.String("video/mp4"),
		URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
	}})
}

// EnviarDocumento: PDF (u otro archivo) con nombre y pie.
func (c *Cliente) EnviarDocumento(tel string, data []byte, nombre, mime, caption string) error {
	if _, _, err := c.destino(tel); err != nil {
		return err
	}
	if mime == "" {
		mime = "application/pdf"
	}
	up, err := c.subir(data, wm.MediaDocument)
	if err != nil {
		return err
	}
	titulo := strings.TrimSuffix(nombre, filepath.Ext(nombre))
	return c.mandar(tel, &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
		FileName: proto.String(nombre), Title: proto.String(titulo), Caption: proto.String(recortar(caption, 1024)), Mimetype: proto.String(mime),
		URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
	}})
}

func soloDigitos(s string) string {
	var b bytes.Buffer
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func recortar(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}
