package bot

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"fieldshift/internal/contract"
)

// Pasos de la conversación.
const (
	PasoInicio    = ""
	PasoUbicacion = "ubicacion"
	PasoElegirMun = "elegir_municipio"
	PasoCultivo   = "cultivo"
	PasoRiego     = "riego"
	PasoGanado    = "ganado"
	PasoPrioridad = "prioridad"
	PasoPlan      = "plan"   // plan entregado; espera 1/2/3 o respuesta de suscripción
	PasoSembro    = "sembro" // ¿ya sembraste?
	PasoFecha     = "fecha"  // ¿qué día?
	PasoListo     = "listo"  // suscrito o no; sigue aceptando 1/2/3, MENU…
)

// Sesion por número (o por id del simulador).
type Sesion struct {
	Tel         string               `json:"tel"`
	Paso        string               `json:"paso"`
	Idioma      string               `json:"idioma"`
	Req         contract.PlanRequest `json:"req"`
	Municipio   string               `json:"municipio,omitempty"` // "Jocotán, Chiquimula"
	Candidatos  []string             `json:"candidatos,omitempty"`
	Ofrecidas   []string             `json:"ofrecidas,omitempty"` // ids de las opciones mostradas (para responder con número)
	Plan        *contract.Plan       `json:"plan,omitempty"`
	Estrategia  string               `json:"estrategia,omitempty"` // la última que miró en detalle
	Suscrito    bool                 `json:"suscrito"`
	Actualizado time.Time            `json:"actualizado"`
}

// Store guarda sesiones en memoria y, si tiene ruta, en un archivo JSON.
type Store struct {
	mu   sync.Mutex
	path string
	m    map[string]*Sesion
}

// NewStore carga el archivo si existe. path vacío = solo memoria.
func NewStore(path string) *Store {
	s := &Store{path: path, m: map[string]*Sesion{}}
	if path != "" {
		if b, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(b, &s.m)
		}
	}
	return s
}

// Get devuelve una copia de la sesión (nueva si no existe).
func (s *Store) Get(tel string) Sesion {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.m[tel]; ok {
		return *v
	}
	return Sesion{Tel: tel, Idioma: "es"}
}

// Put guarda y persiste.
func (s *Store) Put(se Sesion) {
	se.Actualizado = time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := se
	s.m[se.Tel] = &cp
	if s.path == "" {
		return
	}
	b, err := json.Marshal(s.m)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(s.path), 0o755)
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, s.path)
	}
}
