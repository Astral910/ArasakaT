package campo

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// ErrNoEncontrada la parcela no existe o no es de la cuenta (→ 404).
var ErrNoEncontrada = errors.New("parcela no encontrada")

// PrefijoAnon id de historial de las parcelas que llegan por parámetros (sin cuenta).
const PrefijoAnon = "anon:"

// Resolver busca la parcela guardada de la cuenta de la sesión (lo implementa cuentas en cmd/server).
type Resolver func(r *http.Request, id string) (*Parcela, error)

// Areas m² por unidad (las mismas cifras de la ruta /sandbox).
var Areas = map[string]float64{"cuerda": 436.7, "manzana": 6987, "mz": 6987, "ha": 10000, "m2": 1}

// ParcelaDeQuery parcela por parámetros (mientras no haya cuenta, o para probar):
// lat, lon, cultivo, siembra, riego, nombre y area_m2 (o area + unidad cuerda|manzana|ha).
func ParcelaDeQuery(id string, q url.Values) (*Parcela, bool) {
	lat, e1 := strconv.ParseFloat(q.Get("lat"), 64)
	lon, e2 := strconv.ParseFloat(q.Get("lon"), 64)
	if e1 != nil || e2 != nil || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
		return nil, false
	}
	p := &Parcela{ID: id, Nombre: q.Get("nombre"), Lat: lat, Lon: lon, Cultivo: q.Get("cultivo"), Siembra: q.Get("siembra"), Riego: q.Get("riego")}
	if a, err := strconv.ParseFloat(first(q.Get("area_m2"), q.Get("areaM2")), 64); err == nil && a > 0 {
		p.AreaM2 = a
	} else if a, err := strconv.ParseFloat(q.Get("area"), 64); err == nil && a > 0 {
		u := strings.ToLower(q.Get("unidad"))
		if u == "" {
			u = "manzana"
		}
		if f, ok := Areas[u]; ok {
			p.AreaM2 = a * f
		}
	}
	return p, true
}

func first(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

// Routes GET /api/parcelas/{id}/hoy, POST y GET /api/parcelas/{id}/reportes, DELETE …/reportes/{rid}.
// La parcela sale del Resolver (cuenta de la sesión); si no hay o no la encuentra, de los parámetros de la URL.
func Routes(mux *http.ServeMux, s *Servicio, res Resolver) {
	parcela := func(w http.ResponseWriter, r *http.Request) (*Parcela, string, bool) {
		id := r.PathValue("id")
		idioma := r.URL.Query().Get("idioma")
		if idioma != "en" {
			idioma = "es"
		}
		if res != nil {
			p, err := res(r, id)
			if err == nil && p != nil {
				p.ID = id
				return p, idioma, true
			}
			if err != nil && !errors.Is(err, ErrNoEncontrada) {
				fail(w, http.StatusInternalServerError, err.Error())
				return nil, "", false
			}
		}
		// por parámetros: historial aparte ("anon:<id>"), así nadie escribe en el terreno guardado de otra cuenta
		if p, ok := ParcelaDeQuery(PrefijoAnon+id, r.URL.Query()); ok {
			return p, idioma, true
		}
		fail(w, http.StatusNotFound, "parcela no encontrada (con sesión: un terreno de tu cuenta; sin sesión: mandá lat, lon, cultivo, siembra, area y unidad)")
		return nil, "", false
	}
	mux.HandleFunc("GET /api/parcelas/{id}/hoy", func(w http.ResponseWriter, r *http.Request) {
		p, idioma, ok := parcela(w, r)
		if !ok {
			return
		}
		h, err := s.Hoy(*p, idioma)
		if err != nil {
			falloCalculo(w, err)
			return
		}
		writeJSON(w, http.StatusOK, h)
	})
	mux.HandleFunc("GET /api/parcelas/{id}/reportes", func(w http.ResponseWriter, r *http.Request) {
		p, _, ok := parcela(w, r)
		if !ok {
			return
		}
		reps := []Reporte{}
		if s.Store != nil {
			v, err := s.Store.De(p.ID)
			if err != nil {
				fail(w, http.StatusInternalServerError, err.Error())
				return
			}
			if v != nil {
				reps = v
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"reportes": reps})
	})
	mux.HandleFunc("POST /api/parcelas/{id}/reportes", func(w http.ResponseWriter, r *http.Request) {
		p, idioma, ok := parcela(w, r)
		if !ok {
			return
		}
		var rep Reporte
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&rep); err != nil {
			fail(w, http.StatusBadRequest, "cuerpo JSON {fecha, tipo, valor, unidad, texto}: "+err.Error())
			return
		}
		h, err := s.Reportar(*p, rep, idioma)
		if err != nil {
			if errors.Is(err, ErrSinDatos) {
				falloCalculo(w, err)
				return
			}
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, h)
	})
	mux.HandleFunc("DELETE /api/parcelas/{id}/reportes/{rid}", func(w http.ResponseWriter, r *http.Request) {
		p, idioma, ok := parcela(w, r)
		if !ok {
			return
		}
		rid, err := strconv.ParseInt(r.PathValue("rid"), 10, 64)
		if err != nil || s.Store == nil {
			fail(w, http.StatusNotFound, "reporte no encontrado")
			return
		}
		if okDel, err := s.Store.Borrar(p.ID, rid); err != nil || !okDel {
			fail(w, http.StatusNotFound, "reporte no encontrado")
			return
		}
		h, err := s.Hoy(*p, idioma)
		if err != nil {
			falloCalculo(w, err)
			return
		}
		writeJSON(w, http.StatusOK, h)
	})
}

func falloCalculo(w http.ResponseWriter, err error) {
	log.Printf("campo: %v", err)
	code := http.StatusInternalServerError
	if errors.Is(err, ErrSinDatos) {
		code = http.StatusServiceUnavailable
	}
	fail(w, code, fmt.Sprintf("no se pudo calcular el estado de hoy: %v", err))
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
