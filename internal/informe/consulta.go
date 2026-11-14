// Package informe arma el informe técnico final (página /informe de la web) y lo imprime a PDF con
// Chromium headless (chromedp, igual que internal/simvideo). Ruta: GET /api/informe.pdf?<parámetros de /sandbox>.
package informe

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	"fieldshift/internal/contract"
)

// Version del diseño del informe: entra en la clave de caché (cambiarla invalida los PDF viejos).
const Version = "r3.1"

// Consulta: los mismos parámetros que /sandbox (contrato de la ronda 3).
//
//	/informe?lat=14.79&lon=-89.39&lugar=Jocotán&pais=GT&cultivo=milpa&area=2&unidad=manzana&riego=0
type Consulta struct {
	Lat, Lon    *float64
	Lugar       string
	Pais        string
	MunicipioID string // opcional (m | municipio_id)
	Cultivo     string // milpa | maiz | frijol | sorgo | otro
	Area        float64
	Unidad      string // cuerda | manzana | ha
	RiegoMM     int    // 0 | 10 | 20 | 35
	Prioridad   string // comida | agua | suelo | ingreso
	Idioma      string // es | en
}

var cultivos = map[string]bool{"milpa": true, "maiz": true, "frijol": true, "sorgo": true, "otro": true}
var unidades = map[string]bool{"cuerda": true, "manzana": true, "ha": true}
var prioridades = map[string]bool{"comida": true, "agua": true, "suelo": true, "ingreso": true}

// NivelRiego redondea a 0 | 10 | 20 | 35 mm/semana.
func NivelRiego(mm float64) int {
	best := 0
	for _, n := range []int{0, 10, 20, 35} {
		if math.Abs(float64(n)-mm) < math.Abs(float64(best)-mm) {
			best = n
		}
	}
	return best
}

func numero(s string) *float64 {
	if s == "" {
		return nil
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}

// DesdeQuery lee los parámetros de la URL (acepta también los alias de /sandbox: m, municipio_id, lang).
func DesdeQuery(q url.Values) Consulta {
	c := Consulta{
		Lat: numero(q.Get("lat")), Lon: numero(q.Get("lon")),
		Lugar: q.Get("lugar"), Pais: q.Get("pais"),
		MunicipioID: q.Get("municipio_id"), Cultivo: q.Get("cultivo"), Unidad: q.Get("unidad"),
		Prioridad: q.Get("prioridad"), Idioma: q.Get("idioma"),
	}
	if c.MunicipioID == "" {
		c.MunicipioID = q.Get("m")
	}
	if c.Idioma == "" {
		c.Idioma = q.Get("lang")
	}
	if a := numero(q.Get("area")); a != nil {
		c.Area = *a
	}
	r := q.Get("riego")
	if r == "" {
		r = q.Get("riego_mm_semana")
	}
	if v := numero(r); v != nil {
		c.RiegoMM = NivelRiego(*v)
	}
	return c.Normalizar()
}

// DesdePlanRequest para el bot: arma la consulta con lo que respondió el agricultor.
func DesdePlanRequest(r contract.PlanRequest) Consulta {
	c := Consulta{Lat: r.Lat, Lon: r.Lon, MunicipioID: r.MunicipioID, Cultivo: r.Cultivo, Area: r.AreaValor,
		Unidad: r.AreaUnidad, Prioridad: r.Prioridad, Idioma: r.Idioma}
	switch {
	case r.RiegoMMSemana != nil:
		c.RiegoMM = NivelRiego(*r.RiegoMMSemana)
	case r.Riego:
		c.RiegoMM = 20
	}
	return c.Normalizar()
}

// Normalizar aplica los valores por defecto del contrato (milpa, 1 manzana, riego 0).
func (c Consulta) Normalizar() Consulta {
	if !cultivos[c.Cultivo] {
		c.Cultivo = "milpa"
	}
	if !unidades[c.Unidad] {
		c.Unidad = "manzana"
	}
	if c.Area <= 0 || c.Area > 100000 {
		c.Area = 1
	}
	if !prioridades[c.Prioridad] {
		c.Prioridad = "comida"
	}
	if c.Idioma != "en" {
		c.Idioma = "es"
	}
	if c.Lat != nil && (*c.Lat < -90 || *c.Lat > 90) {
		c.Lat = nil
	}
	if c.Lon != nil && (*c.Lon < -180 || *c.Lon > 180) {
		c.Lon = nil
	}
	if c.Lat == nil || c.Lon == nil {
		c.Lat, c.Lon = nil, nil
	}
	if c.Lat == nil && c.MunicipioID == "" {
		c.MunicipioID = "jocotan-chiquimula"
	}
	c.RiegoMM = NivelRiego(float64(c.RiegoMM))
	c.Lugar = recortar(c.Lugar, 80)
	c.Pais = strings.ToUpper(recortar(c.Pais, 3))
	return c
}

func recortar(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// Query: parámetros canónicos para /informe (los mismos de /sandbox).
func (c Consulta) Query() url.Values {
	q := url.Values{}
	if c.Lat != nil {
		q.Set("lat", strconv.FormatFloat(*c.Lat, 'f', 4, 64))
		q.Set("lon", strconv.FormatFloat(*c.Lon, 'f', 4, 64))
	}
	if c.MunicipioID != "" {
		q.Set("m", c.MunicipioID)
	}
	if c.Lugar != "" {
		q.Set("lugar", c.Lugar)
	}
	if c.Pais != "" {
		q.Set("pais", c.Pais)
	}
	q.Set("cultivo", c.Cultivo)
	q.Set("area", strconv.FormatFloat(c.Area, 'f', -1, 64))
	q.Set("unidad", c.Unidad)
	q.Set("riego", strconv.Itoa(c.RiegoMM))
	if c.Prioridad != "comida" {
		q.Set("prioridad", c.Prioridad)
	}
	q.Set("idioma", c.Idioma)
	return q
}

// Clave de caché: consulta canónica + versión + día (el pronóstico cambia cada día).
func (c Consulta) Clave(dia time.Time) string {
	h := sha1.Sum([]byte(Version + "|" + dia.Format("2006-01-02") + "|" + c.Query().Encode()))
	return fmt.Sprintf("informe-%s-%s", c.Idioma, hex.EncodeToString(h[:8]))
}
