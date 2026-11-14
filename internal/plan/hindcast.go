package plan

import (
	"os"
	"path/filepath"
	"sync"

	"fieldshift/internal/data"
	"fieldshift/internal/geo"
)

// Habilidad medida del método de análogos (hindcast leave-one-out 2001–2025, agente validacion):
// web/public/static/validacion/habilidad.json (go run ./cmd/validar). Opcional: sin el archivo queda
// solo la validación de sequías documentadas.
type hindcastLugar struct {
	Nivel     string `json:"nivel"`
	Habilidad string `json:"habilidad"`
}

type hindcastJSON struct {
	Global struct {
		Mundo hindcastLugar `json:"mundo"`
	} `json:"global"`
	Municipios map[string]hindcastLugar `json:"municipios"`
}

var (
	hcMu    sync.Mutex
	hcCache = map[string]*hindcastJSON{}
)

// hindcast lee (una vez por carpeta) habilidad.json de StaticDir o de web/public/static junto a data/.
func (e *Engine) hindcast() *hindcastJSON {
	var rutas []string
	if e.StaticDir != "" {
		rutas = append(rutas, filepath.Join(e.StaticDir, "validacion", "habilidad.json"))
	}
	rutas = append(rutas, filepath.Join(e.Dir, "..", "web", "public", "static", "validacion", "habilidad.json"))
	hcMu.Lock()
	defer hcMu.Unlock()
	for _, r := range rutas {
		if h, ok := hcCache[r]; ok {
			if h != nil {
				return h
			}
			continue
		}
		var h hindcastJSON
		if _, err := os.Stat(r); err != nil || data.ReadJSON(r, &h) != nil {
			hcCache[r] = nil
			continue
		}
		hcCache[r] = &h
		return &h
	}
	return nil
}

// hindcastDe: texto de habilidad y nivel máximo de confianza para el lugar ("" si no hay validación).
func (e *Engine) hindcastDe(m *geo.Municipio) (texto, nivelMax string) {
	h := e.hindcast()
	if h == nil {
		return "", ""
	}
	if m.Global {
		if h.Global.Mundo.Habilidad == "" {
			return "", ""
		}
		return "sin validación local · método en 10 puntos del mundo: " + h.Global.Mundo.Habilidad, h.Global.Mundo.Nivel
	}
	if l, ok := h.Municipios[m.ID]; ok {
		return l.Habilidad, l.Nivel
	}
	return "", ""
}

// topeNivel: la confianza mostrada no pasa del nivel medido en el hindcast del lugar.
func topeNivel(nivel, tope string) string {
	rango := map[string]int{"baja": 0, "media": 1, "alta": 2}
	t, ok := rango[tope]
	if !ok {
		return nivel
	}
	if n, ok := rango[nivel]; ok && n > t {
		return tope
	}
	return nivel
}
