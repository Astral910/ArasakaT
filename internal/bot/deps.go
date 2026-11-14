package bot

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
)

// Suscripciones la implementa ALERTAS (internal/alerts o internal/store). El bot solo la llama.
type Suscripciones interface {
	// Suscribir crea o actualiza el suscriptor (por teléfono). Activo = true.
	Suscribir(s contract.Suscriptor) error
	// Baja desactiva al suscriptor de ese teléfono (BAJA / STOP).
	Baja(tel string) error
	// RegistrarRespuesta guarda la respuesta al seguimiento semanal:
	// respuesta ∈ bien | amarillas | seca | perdida; alertaID puede venir vacío.
	RegistrarRespuesta(tel, alertaID, respuesta string) error
}

// MemSuscripciones: implementación en memoria (tests y mientras ALERTAS no la conecta).
type MemSuscripciones struct {
	mu         sync.Mutex
	Subs       map[string]contract.Suscriptor
	Respuestas []RespuestaSeg
}

type RespuestaSeg struct {
	Tel, AlertaID, Respuesta string
	Fecha                    time.Time
}

func NewMemSuscripciones() *MemSuscripciones {
	return &MemSuscripciones{Subs: map[string]contract.Suscriptor{}}
}

func (m *MemSuscripciones) Suscribir(s contract.Suscriptor) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s.Activo = true
	m.Subs[s.Telefono] = s
	return nil
}

func (m *MemSuscripciones) Baja(tel string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.Subs[tel]; ok {
		s.Activo = false
		m.Subs[tel] = s
	}
	return nil
}

func (m *MemSuscripciones) RegistrarRespuesta(tel, alertaID, respuesta string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Respuestas = append(m.Respuestas, RespuestaSeg{tel, alertaID, respuesta, time.Now()})
	return nil
}

// RepoRoot sube desde el directorio actual hasta encontrar go.mod.
func RepoRoot() string {
	dir, err := os.Getwd()
	if err != nil {
		return "."
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		p := filepath.Dir(dir)
		if p == dir {
			return "."
		}
		dir = p
	}
}

// CargarMunicipios lee data/municipios.json y data/municipios.geojson del repo.
func CargarMunicipios() (*geo.Index, error) {
	root := RepoRoot()
	ms, err := geo.Load(filepath.Join(root, "data", "municipios.json"), filepath.Join(root, "data", "municipios.geojson"))
	if err != nil {
		return nil, err
	}
	return geo.NewIndex(ms), nil
}

// FixturePlanner devuelve contracts/fixtures/plan_jocotan.json (números de ejemplo) con el
// municipio y la solicitud del usuario. Generado = "fixture" para que se note en la tarjeta.
type FixturePlanner struct {
	Municipios *geo.Index
	Path       string // por defecto contracts/fixtures/plan_jocotan.json
	once       sync.Once
	base       contract.Plan
	err        error
}

func (f *FixturePlanner) Plan(req contract.PlanRequest) (contract.Plan, error) {
	f.once.Do(func() {
		path := f.Path
		if path == "" {
			path = filepath.Join(RepoRoot(), "contracts", "fixtures", "plan_jocotan.json")
		}
		var b []byte
		b, f.err = os.ReadFile(path)
		if f.err == nil {
			f.err = json.Unmarshal(b, &f.base)
		}
	})
	if f.err != nil {
		return contract.Plan{}, f.err
	}
	// copia profunda vía JSON
	b, _ := json.Marshal(f.base)
	var p contract.Plan
	_ = json.Unmarshal(b, &p)
	// Si piden otro municipio, idioma o respuestas, los números no son de ese caso: se marca como ejemplo.
	if p.Request.MunicipioID != req.MunicipioID || p.Request.Cultivo != req.Cultivo || p.Request.Idioma != req.Idioma ||
		p.Request.Prioridad != req.Prioridad || p.Request.Riego != req.Riego || p.Generado == "" {
		p.Generado = "fixture"
		p.Resumen = nil
	}
	p.Request = req
	if f.Municipios != nil {
		if m := f.Municipios.ByID[req.MunicipioID]; m != nil {
			p.Municipio = contract.Municipio{ID: m.ID, Nombre: m.Name, Departamento: m.Dept, Lat: m.Lat, Lon: m.Lon}
		}
	}
	return p, nil
}

var errSinPlanner = errors.New("bot: sin planner")

// EsEjemplo: el plan viene del fixture (no de datos reales).
func EsEjemplo(p *contract.Plan) bool {
	return p != nil && strings.EqualFold(p.Generado, "fixture")
}
