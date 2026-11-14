package channels

// Canal "vinculado": WhatsApp por un dispositivo vinculado (internal/channels/whatsmeow), sin Meta ni webhook.
// Mismo bot que Cloud/Twilio/simulador. Botones y listas van como texto (WhatsApp ya no muestra botones a
// clientes no oficiales): "👉 *Sí* · *No*" y listas numeradas; el bot entiende la palabra o el número.

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
	"fieldshift/internal/voz"
)

// Transporte: lo que hace el cliente vinculado (lo cumple whatsmeow.Cliente; en tests, uno falso).
type Transporte interface {
	EnviarTexto(tel, texto string) error
	EnviarImagen(tel string, png []byte, caption string) error
	EnviarVideo(tel string, mp4 []byte, caption string) error
	EnviarDocumento(tel string, data []byte, nombre, mime, caption string) error
	Conectado() bool
}

// FuenteInforme entrega el PDF del informe técnico para una consulta (/api/informe.pdf de INFORME).
type FuenteInforme interface {
	PDF(ctx context.Context, q url.Values) ([]byte, error)
}

// CanalDocumento: canales que mandan el informe PDF 📄 (si no, sale como texto con el link).
type CanalDocumento interface {
	EnviarDocumento(tel string, s bot.Salida) error
}

// InformeHTTP baja el PDF del propio servidor (GET Base/api/informe.pdf?...). Mientras INFORME no esté
// integrado responde 404 y el canal manda el link a la página del informe.
type InformeHTTP struct {
	Base string
	HTTP *http.Client
}

func (f InformeHTTP) PDF(ctx context.Context, q url.Values) ([]byte, error) {
	if f.Base == "" {
		return nil, errors.New("informe: sin URL base")
	}
	cl := f.HTTP
	if cl == nil {
		cl = &http.Client{Timeout: 3 * time.Minute}
	}
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(f.Base, "/")+"/api/informe.pdf?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	res, err := cl.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Type"), "pdf") {
		return nil, errors.New("informe: " + res.Status)
	}
	return leerTodo(res, 20<<20)
}

// queryDoc: la consulta de una salida de documento (/api/informe.pdf?...).
func queryDoc(s bot.Salida) url.Values {
	_, q, _ := strings.Cut(s.DocURL, "?")
	v, _ := url.ParseQuery(q)
	return v
}

// textoDocLink: respaldo del informe (link a la página imprimible o al PDF).
func textoDocLink(s bot.Salida, publicURL string) string {
	link := s.LinkURL
	if link == "" && publicURL != "" && s.DocURL != "" {
		link = strings.TrimRight(publicURL, "/") + s.DocURL
	}
	if link == "" {
		return s.Texto
	}
	return s.Texto + "\n👉 " + link
}

// Vinculado: el canal.
type Vinculado struct {
	T         Transporte
	Bot       *bot.Bot
	Videos    FuenteVideo
	Informes  FuenteInforme
	PublicURL string
	Sync      bool // tests: responde en el mismo goroutine

	dd    *dedup
	locks sync.Map
}

// NewVinculado arma el canal sobre un transporte.
func NewVinculado(t Transporte, b *bot.Bot) *Vinculado {
	return &Vinculado{T: t, Bot: b, dd: newDedup()}
}

// Activo: hay transporte (aunque esté reconectando: los envíos fallan y las alertas se reintentan).
func (v *Vinculado) Activo() bool { return v != nil && v.T != nil }

// Recibir: mensaje entrante del dispositivo vinculado → bot → respuestas, en orden por teléfono.
func (v *Vinculado) Recibir(id string, e bot.Entrada) {
	if v.dd.visto(id) {
		return
	}
	proc := func() {
		mu, _ := v.locks.LoadOrStore(e.Tel, &sync.Mutex{})
		mu.(*sync.Mutex).Lock()
		defer mu.(*sync.Mutex).Unlock()
		log.Printf("vinculado: ← %s %s", bot.Enmascarar(e.Tel), e.Tipo)
		oyo := false
		if e.Tipo == "audio" && len(e.Audio) > 0 {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			texto, _, aviso := voz.EntradaDeAudio(ctx, e.Audio, v.Bot.IdiomaDe(e.Tel))
			cancel()
			if aviso != "" {
				_ = v.T.EnviarTexto(e.Tel, aviso)
				return
			}
			e.Tipo, e.Texto, e.Audio, oyo = "text", texto, nil, true
		}
		out := v.Bot.Responder(e)
		Entregar(v, e.Tel, out)
		v.hablar(e.Tel, out, oyo)
	}
	if v.Sync {
		proc()
		return
	}
	go proc()
}

// NotaVoz: transportes que mandan notas de voz (whatsmeow.Cliente).
type NotaVoz interface {
	EnviarNota(tel string, ogg []byte) error
}

// hablar: si la persona pidió AUDIOS, cada texto del bot sale también como nota de voz (el texto va igual,
// por los enlaces y opciones). Primera nota entendida con los audios apagados → se ofrecen una vez.
func (v *Vinculado) hablar(tel string, out []bot.Salida, oyo bool) {
	nv, ok := v.T.(NotaVoz)
	if !ok {
		return
	}
	L := v.Bot.IdiomaDe(tel)
	if !v.Bot.AudiosDe(tel) {
		if oyo && v.Bot.OfrecerAudios(tel) {
			_ = v.T.EnviarTexto(tel, voz.TextoOfrecerAudios(L))
		}
		return
	}
	for _, s := range out {
		switch s.Tipo {
		case "text", "buttons", "list", "location_request", "":
		default:
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		ogg, err := voz.Hablar(ctx, s.Texto, L)
		cancel()
		if err != nil {
			log.Printf("vinculado: voz para %s: %v → solo texto", bot.Enmascarar(tel), err)
			return
		}
		if err := nv.EnviarNota(tel, ogg); err != nil {
			log.Printf("vinculado: nota a %s: %v", bot.Enmascarar(tel), err)
			return
		}
	}
}

// ---------- Canal + Mensajero ----------

func (v *Vinculado) EnviarTexto(tel, texto string) error { return v.T.EnviarTexto(tel, texto) }

func (v *Vinculado) EnviarBotones(tel, texto string, botones []contract.Boton) error {
	return v.T.EnviarTexto(tel, TextoPlano(bot.Salida{Tipo: "buttons", Texto: texto, Botones: botones}))
}

func (v *Vinculado) EnviarLista(tel, texto string, opciones []contract.Boton) error {
	return v.T.EnviarTexto(tel, TextoPlano(bot.Salida{Tipo: "list", Texto: texto, Botones: opciones}))
}

func (v *Vinculado) PedirUbicacion(tel, texto string) error {
	return v.T.EnviarTexto(tel, texto+"\n📎 → Ubicación 📍 / Location")
}

func (v *Vinculado) EnviarImagen(tel string, png []byte, caption string) error {
	return v.T.EnviarImagen(tel, png, caption)
}

// EnviarPlantilla: sin regla de 24 h no hacen falta plantillas; por si alguien la llama, van las variables como texto.
func (v *Vinculado) EnviarPlantilla(tel, plantilla, idioma string, vars []string) error {
	return v.T.EnviarTexto(tel, strings.Join(vars, "\n"))
}

// SinVentana: el dispositivo vinculado no tiene la ventana de 24 h de Meta (alerts.SinVentana).
func (v *Vinculado) SinVentana(string) bool { return true }

// EnviarVideo: el MP4 del sandbox (simvideo); si falla, el texto con el link.
func (v *Vinculado) EnviarVideo(tel string, s bot.Salida) error {
	err := func() error {
		if v.Videos == nil {
			return errors.New("sin servicio de video")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		mp4, _, err := v.Videos.Bytes(ctx, queryVideo(s))
		if err != nil {
			return err
		}
		return v.T.EnviarVideo(tel, mp4, s.Texto)
	}()
	if err != nil {
		log.Printf("vinculado: video a %s: %v → texto con link", bot.Enmascarar(tel), err)
		return v.T.EnviarTexto(tel, textoConLink(s, v.PublicURL))
	}
	return nil
}

// EnviarDocumento: el informe PDF; si todavía no está, el link a la página del informe.
func (v *Vinculado) EnviarDocumento(tel string, s bot.Salida) error {
	err := func() error {
		if v.Informes == nil {
			return errors.New("sin fuente de informes")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		pdf, err := v.Informes.PDF(ctx, queryDoc(s))
		if err != nil {
			return err
		}
		return v.T.EnviarDocumento(tel, pdf, s.DocNombre, "application/pdf", s.Texto)
	}()
	if err != nil {
		log.Printf("vinculado: informe a %s: %v → texto con link", bot.Enmascarar(tel), err)
		return v.T.EnviarTexto(tel, textoDocLink(s, v.PublicURL))
	}
	return nil
}

var (
	_ Canal          = (*Vinculado)(nil)
	_ CanalVideo     = (*Vinculado)(nil)
	_ CanalDocumento = (*Vinculado)(nil)
)

func leerTodo(res *http.Response, max int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, errors.New("informe: PDF demasiado grande")
	}
	return b, nil
}
