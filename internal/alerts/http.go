package alerts

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/forecast"
	"fieldshift/internal/store"
)

// Config para armar el servicio de alertas (lo usa cmd/server).
type Config struct {
	DataDir    string // data/ del motor
	DBPath     string // SQLite; vacío = DATA_DIR/../var/fieldshift.db → por defecto "var/fieldshift.db"
	CacheDir   string // caché de pronósticos en vivo; vacío = "var/cache/forecast"
	AdminToken string // ADMIN_TOKEN; vacío = rutas de admin cerradas
	Mensajero  contract.Mensajero
}

// Service motor + store + archivos.
type Service struct {
	Engine     *Engine
	Store      *store.Store
	Archives   *forecast.Archives
	AdminToken string

	once sync.Once
	tls  []Timeline
	err  error
}

// New arma el servicio. El bot recibe Service.Store como store.Suscripciones.
func New(c Config) (*Service, error) {
	if c.DBPath == "" {
		c.DBPath = filepath.Join("var", "fieldshift.db")
	}
	if c.CacheDir == "" {
		c.CacheDir = filepath.Join("var", "cache", "forecast")
	}
	if c.AdminToken == "" {
		c.AdminToken = os.Getenv("ADMIN_TOKEN")
	}
	st, err := store.Open(c.DBPath)
	if err != nil {
		return nil, err
	}
	as := forecast.LoadArchives(c.DataDir)
	live := forecast.NewClient(c.CacheDir)
	live.Fresco = 3 * time.Hour // el scheduler revisa cada 3 h: el pronóstico en caché no puede ser más viejo
	e, err := NewEngine(st, &forecast.Provider{Archives: as, Live: live}, c.Mensajero, c.DataDir)
	if err != nil {
		st.Close()
		return nil, err
	}
	return &Service{Engine: e, Store: st, Archives: as, AdminToken: c.AdminToken}, nil
}

// PruebaAlerta: PRUEBA ALERTA del bot (alerta real calculada al instante para el lugar del suscriptor).
func (s *Service) PruebaAlerta(sus contract.Suscriptor) ([]string, error) {
	return s.Engine.Prueba(sus)
}

// Correr: corrida "ahora" (scheduler cada 3 h).
func (s *Service) Correr(now time.Time) error { _, err := s.Engine.Correr(now); return err }

// StartScheduler corre el motor a las 06:00 hora de Guatemala.
func (s *Service) StartScheduler() (stop func()) { return StartScheduler(s.Engine) }

// Timelines máquina del tiempo (se calcula una vez).
func (s *Service) Timelines() ([]Timeline, error) {
	s.once.Do(func() { s.tls, s.err = RunBacktests(s.Engine, s.Archives) })
	return s.tls, s.err
}

// Routes monta:
//
//	POST /api/alerts/subscribe            alta (o {"accion":"baja"}) — opt-in desde la web o el bot
//	GET  /api/alerts/backtest?municipio=  resumen de la máquina del tiempo 2026
//	GET  /api/alerts/timeline?municipio=&anio=2026
//	GET  /api/admin/resumen               conteos por municipio, alertas activas, respuestas (sin teléfonos)
//	POST /api/admin/run-alerts?date=YYYY-MM-DD[&force=1]   protegido con ADMIN_TOKEN (Authorization: Bearer …)
func Routes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("POST /api/alerts/subscribe", s.subscribe)
	mux.HandleFunc("GET /api/alerts/backtest", s.backtest)
	mux.HandleFunc("GET /api/alerts/timeline", s.timeline)
	mux.HandleFunc("GET /api/admin/resumen", s.resumen)
	mux.HandleFunc("POST /api/admin/run-alerts", s.runAlerts)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

type subReq struct {
	contract.Suscriptor
	Accion string `json:"accion"` // "" | alta | baja
	Acepto *bool  `json:"acepto"` // consentimiento explícito (web)
}

func (s *Service) subscribe(w http.ResponseWriter, r *http.Request) {
	var in subReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in); err != nil {
		fail(w, 400, "JSON inválido")
		return
	}
	if !store.TelValido(in.Telefono) {
		fail(w, 400, "teléfono inválido")
		return
	}
	if in.Accion == "baja" {
		if err := s.Store.Baja(in.Telefono); err != nil {
			fail(w, 500, "no se pudo dar de baja")
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "activo": false, "telefono": store.Mask(in.Telefono)})
		return
	}
	if in.Acepto != nil && !*in.Acepto {
		fail(w, 400, "sin consentimiento no se guarda nada")
		return
	}
	// Cualquier lugar del mundo: municipio precalculado, "pt:<lat>,<lon>|<nombre>" o solo lat/lon.
	if m, ok := s.Engine.Munis[in.MunicipioID]; ok {
		if in.Lat == 0 && in.Lon == 0 {
			in.Lat, in.Lon = m.Lat, m.Lon
		}
	} else if lat, lon, _, ok := ParsePunto(in.MunicipioID); ok {
		in.Lat, in.Lon = lat, lon
	} else if in.Lat != 0 || in.Lon != 0 {
		in.MunicipioID = PuntoID(in.Lat, in.Lon, "")
	} else {
		fail(w, 400, "municipio_id desconocido")
		return
	}
	if in.FechaSiembra != "" {
		if _, err := time.Parse("2006-01-02", in.FechaSiembra); err != nil {
			fail(w, 400, "fecha_siembra debe ser YYYY-MM-DD")
			return
		}
	}
	if in.Idioma != "en" {
		in.Idioma = "es"
	}
	sus, err := s.Store.Suscribir(in.Suscriptor)
	if err != nil {
		fail(w, 500, "no se pudo guardar")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "id": sus.ID, "activo": true, "municipio_id": sus.MunicipioID,
		"telefono": store.Mask(sus.Telefono), "idioma": sus.Idioma})
}

func (s *Service) backtest(w http.ResponseWriter, r *http.Request) {
	tls, err := s.Timelines()
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	sum := Summary(tls)
	if id := r.URL.Query().Get("municipio"); id != "" {
		for _, m := range sum.Municipios {
			if m.MunicipioID == id {
				writeJSON(w, 200, m)
				return
			}
		}
		fail(w, 404, "sin máquina del tiempo para "+id)
		return
	}
	writeJSON(w, 200, sum)
}

func (s *Service) timeline(w http.ResponseWriter, r *http.Request) {
	tls, err := s.Timelines()
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	id := r.URL.Query().Get("municipio")
	if id == "" {
		id = "jocotan-chiquimula"
	}
	anio := r.URL.Query().Get("anio")
	for _, t := range tls {
		if t.MunicipioID == id && (anio == "" || anio == itoa(t.Anio)) {
			writeJSON(w, 200, t)
			return
		}
	}
	fail(w, 404, "sin línea de tiempo para "+id)
}

// Resumen panel del extensionista.
type Resumen struct {
	Generado       string          `json:"generado"`
	Municipios     []ResumenMuni   `json:"municipios"`
	AlertasActivas []AlertaPublica `json:"alertas_activas"`
	Totales        map[string]int  `json:"totales"`
	// forma de web/src/features/alertas/maquina.ts (PanelResumen)
	Suscriptores []ConteoMuni      `json:"suscriptores"`
	Respuestas   []ConteoRespuesta `json:"respuestas"`
	Ejemplo      bool              `json:"ejemplo"`
	Aviso        string            `json:"_aviso,omitempty"`
}

// ConteoMuni suscriptores activos por municipio.
type ConteoMuni struct {
	MunicipioID string `json:"municipio_id"`
	N           int    `json:"n"`
}

// ConteoRespuesta respuestas del seguimiento por municipio y estado (bien | amarillas | secando | perdida).
type ConteoRespuesta struct {
	MunicipioID string `json:"municipio_id"`
	Estado      string `json:"estado"`
	N           int    `json:"n"`
}

// ResumenMuni conteos de un municipio con nombre y coordenadas (para el mapa).
type ResumenMuni struct {
	store.ResumenMunicipio
	Nombre       string  `json:"nombre"`
	Departamento string  `json:"departamento"`
	Lat          float64 `json:"lat"`
	Lon          float64 `json:"lon"`
}

// AlertaPublica alerta sin datos personales (una por municipio, tipo y fecha).
type AlertaPublica struct {
	ID            string   `json:"id"`
	Texto         string   `json:"texto"`
	Acciones      []string `json:"acciones"`
	Plantilla     string   `json:"plantilla"`
	Vars          []string `json:"vars"`
	MunicipioID   string   `json:"municipio_id"`
	Municipio     string   `json:"municipio"`
	Tipo          string   `json:"tipo"`
	FechaEmision  string   `json:"fecha_emision"`
	Inicio        string   `json:"inicio"`
	Dias          int      `json:"dias"`
	Probabilidad  float64  `json:"probabilidad"`
	Titulo        string   `json:"titulo"`
	Destinatarios int      `json:"destinatarios"`
	Lat           float64  `json:"lat"`
	Lon           float64  `json:"lon"`
}

func (s *Service) resumen(w http.ResponseWriter, r *http.Request) {
	desde := Day(s.Engine.now()).AddDate(0, 0, -7).Format("2006-01-02")
	if d := r.URL.Query().Get("desde"); d != "" {
		if _, err := time.Parse("2006-01-02", d); err == nil {
			desde = d
		}
	}
	rs, err := s.Store.Resumen(desde)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	out := Resumen{Generado: time.Now().UTC().Format(time.RFC3339), Municipios: []ResumenMuni{}, AlertasActivas: []AlertaPublica{}, Totales: map[string]int{},
		Suscriptores: []ConteoMuni{}, Respuestas: []ConteoRespuesta{}}
	for _, x := range rs {
		m := s.Engine.Munis[x.MunicipioID]
		out.Municipios = append(out.Municipios, ResumenMuni{ResumenMunicipio: x, Nombre: m.Name, Departamento: m.Dept, Lat: m.Lat, Lon: m.Lon})
		out.Suscriptores = append(out.Suscriptores, ConteoMuni{MunicipioID: x.MunicipioID, N: x.Activos})
		for _, k := range sortedKeys(x.Respuestas) {
			out.Respuestas = append(out.Respuestas, ConteoRespuesta{MunicipioID: x.MunicipioID, Estado: estadoDe(k), N: x.Respuestas[k]})
		}
		out.Totales["suscriptores"] += x.Suscriptores
		out.Totales["activos"] += x.Activos
		for _, n := range x.Respuestas {
			out.Totales["respuestas"] += n
		}
	}
	als, err := s.Store.AlertasDe("", desde, 2000)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	idx := map[string]int{}
	for _, a := range als {
		if a.Tipo == TSeguimiento {
			continue
		}
		k := a.MunicipioID + "|" + a.Tipo + "|" + a.FechaEmision
		if i, ok := idx[k]; ok {
			out.AlertasActivas[i].Destinatarios++
			continue
		}
		m := s.Engine.Munis[a.MunicipioID]
		titulo := a.Titulo
		if i := strings.Index(titulo, " · "); i > 0 {
			titulo = titulo[:i] + " · " + m.Name
		}
		idx[k] = len(out.AlertasActivas)
		out.AlertasActivas = append(out.AlertasActivas, AlertaPublica{ID: a.ID, Texto: a.Texto, Acciones: a.Acciones, Plantilla: a.Plantilla, Vars: a.Vars, MunicipioID: a.MunicipioID, Municipio: m.Name, Tipo: a.Tipo, FechaEmision: a.FechaEmision,
			Inicio: a.Inicio, Dias: a.Dias, Probabilidad: a.Probabilidad, Titulo: titulo, Destinatarios: 1, Lat: m.Lat, Lon: m.Lon})
	}
	out.Totales["alertas_activas"] = len(out.AlertasActivas)
	writeJSON(w, 200, out)
}

func (s *Service) authorized(r *http.Request) bool {
	if s.AdminToken == "" {
		return false
	}
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if tok == "" {
		tok = r.Header.Get("X-Admin-Token")
	}
	return subtle.ConstantTimeCompare([]byte(tok), []byte(s.AdminToken)) == 1
}

func (s *Service) runAlerts(w http.ResponseWriter, r *http.Request) {
	if s.AdminToken == "" {
		fail(w, 503, "ADMIN_TOKEN no configurado")
		return
	}
	if !s.authorized(r) {
		fail(w, 401, "token inválido")
		return
	}
	d := Day(s.Engine.now())
	if q := r.URL.Query().Get("date"); q != "" {
		t, err := time.Parse("2006-01-02", q)
		if err != nil {
			fail(w, 400, "date debe ser YYYY-MM-DD")
			return
		}
		d = t
	}
	force := r.URL.Query().Get("force") == "1"
	// corrida a mano con fecha (máquina del tiempo) o forzada: no espera el horario decente
	manual := force || r.URL.Query().Get("date") != ""
	res, err := s.Engine.correr(d, force, manual)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	for i := range res.Alertas {
		res.Alertas[i].SuscriptorID = "" // sin datos personales en la respuesta
	}
	writeJSON(w, 200, res)
}

// estadoDe respuesta guardada (id de botón o texto) → estado del panel.
func estadoDe(r string) string {
	r = strings.ToLower(strings.TrimPrefix(r, "seg_"))
	switch {
	case strings.Contains(r, "amarill"), strings.Contains(r, "yellow"):
		return "amarillas"
	case strings.Contains(r, "sec"), strings.Contains(r, "dry"):
		return "secando"
	case strings.Contains(r, "perd"), strings.Contains(r, "lost"):
		return "perdida"
	case strings.Contains(r, "bien"), strings.Contains(r, "good"):
		return "bien"
	}
	return r
}

func sortedKeys[V any](m map[string]V) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}
