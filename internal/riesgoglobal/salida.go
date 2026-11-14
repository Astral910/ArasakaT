package riesgoglobal

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"

	"golang.org/x/text/language"
	"golang.org/x/text/language/display"

	"fieldshift/internal/geo"
)

// Escala es la misma del mapa de Guatemala (web/src/features/mapa/riesgo.ts, ESCALA_RIESGO):
// temporadas difíciles de cada 10, jade → maíz → granada.
var Escala = []struct {
	Hasta float64
	Color string
}{
	{1, "#2a8a66"},
	{2, "#8fb15a"},
	{3, "#e0a526"},
	{4.5, "#d9713a"},
	{99, "#b5343c"},
}

// SinDato color neutro (hueso) para regiones sin cálculo.
const SinDato = "#d8cdb5"

// Color de un riesgo (< hasta, igual que colorDe en la web).
func Color(r float64) string {
	for _, e := range Escala {
		if r < e.Hasta {
			return e.Color
		}
	}
	return Escala[len(Escala)-1].Color
}

// Nivel igual que la web: alto ≥ 4.5, medio ≥ 2, bajo.
func Nivel(r float64) string {
	switch {
	case r >= 4.5:
		return "alto"
	case r >= 2:
		return "medio"
	}
	return "bajo"
}

// Props propiedades de cada región (forma anotada en COORDINACION.md para vuelo3).
type Props struct {
	ID       string     `json:"id"`        // ISO3 (ADM0) o ISO3-slug (ADM1)
	Nombre   string     `json:"nombre"`    // nombre de la región (ADM1) o del país (ADM0), en español
	NombreEN string     `json:"nombre_en"` // nombre en inglés
	Pais     string     `json:"pais"`      // país en español
	PaisEN   string     `json:"pais_en"`
	ISO      string     `json:"iso"`    // ISO 3166-1 alfa-3
	Nivel    string     `json:"nivel"`  // ADM1 | ADM0
	Riesgo   *float64   `json:"riesgo"` // temporadas difíciles de cada 10 (0–10, 1 decimal); null = sin dato
	Clase    string     `json:"clase"`  // bajo | medio | alto | sin-dato
	Color    string     `json:"color"`  // color de la escala de Guatemala
	Metodo   string     `json:"metodo"` // motor | grueso | mixto | municipios-gt | motor-adm1
	Puntos   int        `json:"puntos"` // celdas NASA POWER usadas
	Centro   [2]float64 `json:"centro"` // [lon, lat] punto para centrar la cámara
	Fuente   string     `json:"fuente"`
}

// Feature de salida.
type Feature struct {
	Props Props
	Polys []geo.Polygon
}

// Doc metadatos del FeatureCollection (miembros extra permitidos por RFC 7946).
type Doc struct {
	Fuente     string       `json:"fuente"`
	Periodo    string       `json:"periodo"`
	Nota       string       `json:"nota"`
	NotaEN     string       `json:"nota_en"`
	Escala     []EscalaItem `json:"escala"`
	Validacion *Validacion  `json:"validacion,omitempty"`
	Generado   string       `json:"generado"`
}

// EscalaItem para que el cliente pinte la leyenda.
type EscalaItem struct {
	Hasta float64 `json:"hasta"`
	Color string  `json:"color"`
}

// EscalaDoc la escala lista para el documento.
func EscalaDoc() []EscalaItem {
	out := make([]EscalaItem, len(Escala))
	for i, e := range Escala {
		out[i] = EscalaItem{e.Hasta, e.Color}
	}
	return out
}

// Write escribe el FeatureCollection compacto.
func Write(path string, d Doc, fs []Feature) error {
	type gj struct {
		Type        string           `json:"type"`
		Coordinates [][][][2]float64 `json:"coordinates"`
	}
	type feat struct {
		Type       string `json:"type"`
		Properties Props  `json:"properties"`
		Geometry   gj     `json:"geometry"`
	}
	out := struct {
		Type string `json:"type"`
		Doc
		Features []feat `json:"features"`
	}{Type: "FeatureCollection", Doc: d}
	for _, f := range fs {
		c := make([][][][2]float64, len(f.Polys))
		for i, p := range f.Polys {
			c[i] = make([][][2]float64, len(p))
			for k, r := range p {
				c[i][k] = r
			}
		}
		out.Features = append(out.Features, feat{"Feature", f.Props, gj{"MultiPolygon", c}})
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		return err
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}

// PaisES nombre del país en español a partir del ISO3 (CLDR vía x/text); si no, el dado.
func PaisES(iso, def string) string {
	if r, err := language.ParseRegion(iso); err == nil {
		if n := display.Spanish.Regions().Name(r); n != "" && !strings.EqualFold(n, iso) {
			return n
		}
	}
	return def
}

// PaisEN nombre del país en inglés (CLDR); si no, el dado.
func PaisEN(iso, def string) string {
	if r, err := language.ParseRegion(iso); err == nil {
		if n := display.English.Regions().Name(r); n != "" && !strings.EqualFold(n, iso) {
			return n
		}
	}
	return def
}
