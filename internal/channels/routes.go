package channels

import (
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"fieldshift/internal/bot"
	"fieldshift/internal/cards"
	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
	"fieldshift/internal/simvideo"
)

// Deps para montar el bot. Todo es opcional: sin Planner usa el fixture, sin Subs usa memoria,
// sin credenciales los canales de WhatsApp quedan apagados (el simulador siempre funciona).
type Deps struct {
	Bot          *bot.Bot // si viene, se usa tal cual
	Planner      contract.Planner
	Municipios   *geo.Index
	Subs         bot.Suscripciones
	SesionesPath string // archivo de sesiones; vacío = memoria
	NombreBot    string // BOT_NOMBRE
	WebURL       string // WEB_URL: base pública de la web (link "ver el plan completo")
	PublicURL    string // PUBLIC_URL: base pública de la API (imágenes para Twilio)
	Cloud        CloudConfig
	Twilio       TwilioConfig
	// Videos: MP4 del sandbox (VIDEO 🎬). Nil = se arma simvideo desde el entorno y se monta
	// GET /api/sim/video.mp4 (ver docs/video.md). SinVideo = no montar nada.
	Videos   FuenteVideo
	SinVideo bool
	// Informes: PDF del informe técnico (📄). Nil = InformeHTTP sobre InformeBase (o PublicURL).
	Informes    FuenteInforme
	InformeBase string
	// Geo: lugares del mundo por nombre y nombre de una coordenada. Pruebas: PRUEBA ALERTA (alerts.Service).
	Geo     bot.Geocoder
	Pruebas bot.Probador
	// Vinculado: transporte de WhatsApp vinculado (whatsmeow, WA_MODO=vinculado). Si viene, manda sobre Cloud/Twilio.
	Vinculado Transporte
}

// DepsDesdeEnv lee la configuración de variables de entorno (ver docs/whatsapp-setup.md).
func DepsDesdeEnv() Deps {
	d := Deps{
		NombreBot:    os.Getenv("BOT_NOMBRE"),
		WebURL:       os.Getenv("WEB_URL"),
		PublicURL:    os.Getenv("PUBLIC_URL"),
		SesionesPath: os.Getenv("BOT_SESIONES"),
		Cloud: CloudConfig{
			Token:         os.Getenv("WHATSAPP_TOKEN"),
			PhoneNumberID: os.Getenv("WHATSAPP_PHONE_NUMBER_ID"),
			AppSecret:     os.Getenv("WHATSAPP_APP_SECRET"),
			VerifyToken:   os.Getenv("WHATSAPP_VERIFY_TOKEN"),
			APIVersion:    os.Getenv("WHATSAPP_API_VERSION"),
		},
		Twilio: TwilioConfig{
			AccountSID: os.Getenv("TWILIO_ACCOUNT_SID"),
			AuthToken:  os.Getenv("TWILIO_AUTH_TOKEN"),
			From:       os.Getenv("TWILIO_WHATSAPP_FROM"),
			ContentSID: map[string]string{},
		},
	}
	if d.SesionesPath == "" {
		d.SesionesPath = filepath.Join(os.TempDir(), "fieldshift", "sesiones.json")
	}
	for _, kv := range os.Environ() {
		if k, v, ok := strings.Cut(kv, "="); ok && strings.HasPrefix(k, "TWILIO_CONTENT_") && v != "" {
			d.Twilio.ContentSID[strings.ToLower(strings.TrimPrefix(k, "TWILIO_CONTENT_"))] = v
		}
	}
	return d
}

// Servicio: lo que queda montado. Mensajero enruta por teléfono (para ALERTAS):
// "web:<id>" → simulador; otro número → WhatsApp Cloud si hay credenciales, si no Twilio.
type Servicio struct {
	Bot       *bot.Bot
	Cloud     *Cloud
	Twilio    *Twilio
	Web       *Web
	Media     *MediaStore
	Vinculado *Vinculado // nil si WA_MODO no es vinculado
	Mensajero contract.Mensajero
}

// Routes monta /api/chat, /webhook/whatsapp, /webhook/twilio, /api/cards/plan.png y /api/cards/media/.
func Routes(mux *http.ServeMux, d Deps) *Servicio {
	b := d.Bot
	if b == nil {
		if d.Municipios == nil {
			ix, err := bot.CargarMunicipios()
			if err != nil {
				log.Printf("channels: municipios: %v (búsqueda desactivada)", err)
			}
			d.Municipios = ix
		}
		if d.Planner == nil {
			log.Printf("channels: sin planner, uso el fixture (números de ejemplo)")
			d.Planner = &bot.FixturePlanner{Municipios: d.Municipios}
		}
		if d.Subs == nil {
			d.Subs = bot.NewMemSuscripciones()
		}
		b = &bot.Bot{Planner: d.Planner, Municipios: d.Municipios, Subs: d.Subs,
			Sesiones: bot.NewStore(d.SesionesPath), Nombre: d.NombreBot, WebURL: d.WebURL, Geo: d.Geo, Pruebas: d.Pruebas}
	}
	if d.Planner == nil {
		d.Planner = b.Planner
	}
	media := NewMediaStore()
	s := &Servicio{
		Bot:    b,
		Cloud:  NewCloud(d.Cloud, b),
		Twilio: NewTwilio(d.Twilio, b, d.PublicURL, media),
		Web:    NewWeb(b, d.PublicURL),
		Media:  media,
	}
	s.Mensajero = &router{s: s}

	// VIDEO 🎬: /api/sim/video.mp4 (caché + render headless + precalculados).
	if d.Videos == nil && !d.SinVideo {
		vs := simvideo.Nuevo(simvideo.ConfigDesdeEnv())
		simvideo.Routes(mux, vs)
		d.Videos = vs
		log.Printf("channels: video 3D en /api/sim/video.mp4 (render=%v, precalculados=%q)", vs.Render != nil, vs.Cfg.PrecalcDir)
	}
	s.Cloud.Videos, s.Cloud.PublicURL = d.Videos, d.PublicURL
	// INFORME 📄: /api/informe.pdf del propio servidor (lo monta el agente informe; sin él, va el link).
	if d.Informes == nil {
		base := d.InformeBase
		if base == "" {
			base = d.PublicURL
		}
		d.Informes = InformeHTTP{Base: base}
	}
	s.Cloud.Informes = d.Informes
	if d.Vinculado != nil {
		s.Vinculado = NewVinculado(d.Vinculado, b)
		s.Vinculado.Videos, s.Vinculado.Informes, s.Vinculado.PublicURL = d.Videos, d.Informes, d.PublicURL
	}

	mux.Handle("/api/chat", s.Web)
	mux.Handle("/webhook/whatsapp", s.Cloud)
	mux.Handle("/webhook/twilio", s.Twilio)
	mux.Handle("/api/cards/plan.png", cards.Handler(d.Planner))
	mux.Handle("/api/cards/media/", media)

	log.Printf("channels: simulador web activo · WhatsApp vinculado: %v · WhatsApp Cloud: %v · Twilio: %v", s.Vinculado.Activo(), d.Cloud.Activo(), d.Twilio.Activo())
	return s
}

// router implementa contract.Mensajero eligiendo el canal por el teléfono.
type router struct{ s *Servicio }

func (r *router) canal(tel string) Canal {
	switch {
	case strings.HasPrefix(tel, "web:"):
		return r.s.Web
	case r.s.Vinculado.Activo():
		return r.s.Vinculado
	case r.s.Cloud.Cfg.Activo():
		return r.s.Cloud
	case r.s.Twilio.Cfg.Activo():
		return r.s.Twilio
	}
	return r.s.Web
}

func (r *router) EnviarTexto(tel, texto string) error { return r.canal(tel).EnviarTexto(tel, texto) }

// SinVentana: el canal de ese teléfono no tiene la ventana de 24 h (vinculado, simulador) → alertas como texto.
func (r *router) SinVentana(tel string) bool {
	c := r.canal(tel)
	if sv, ok := c.(interface{ SinVentana(string) bool }); ok {
		return sv.SinVentana(tel)
	}
	return c == Canal(r.s.Web)
}
func (r *router) EnviarBotones(tel, texto string, b []contract.Boton) error {
	return r.canal(tel).EnviarBotones(tel, texto, b)
}
func (r *router) EnviarImagen(tel string, png []byte, caption string) error {
	return r.canal(tel).EnviarImagen(tel, png, caption)
}
func (r *router) EnviarPlantilla(tel, plantilla, idioma string, vars []string) error {
	return r.canal(tel).EnviarPlantilla(tel, plantilla, idioma, vars)
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }
