// Package geo: municipios de Guatemala (geoBoundaries ADM2), punto en polígono y centroides.
package geo

import (
	"encoding/json"
	"math"
	"os"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Ring es un anillo [lon, lat].
type Ring [][2]float64

// Polygon: primer anillo exterior, resto huecos.
type Polygon []Ring

// Municipio con su geometría y metadatos derivados.
type Municipio struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Dept     string     `json:"dept"`
	Lat      float64    `json:"lat"`
	Lon      float64    `json:"lon"`
	Cell     string     `json:"cell"`
	ElevM    float64    `json:"elev_m"`
	SlopePct float64    `json:"slope_pct"`
	Polys    []Polygon  `json:"-"`
	BBox     [4]float64 `json:"bbox"`
	// Global: punto fuera de Guatemala (datos bajo demanda, sin polígono). Pais: código ISO si se sabe.
	Global bool   `json:"global,omitempty"`
	Pais   string `json:"pais,omitempty"`
}

type rawFC struct {
	Features []struct {
		Properties map[string]any `json:"properties"`
		Geometry   struct {
			Type        string          `json:"type"`
			Coordinates json.RawMessage `json:"coordinates"`
		} `json:"geometry"`
	} `json:"features"`
}

// Feature genérico leído de un GeoJSON.
type Feature struct {
	Props map[string]any
	Polys []Polygon
}

// ReadGeoJSON lee Polygon/MultiPolygon.
func ReadGeoJSON(path string) ([]Feature, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fc rawFC
	if err := json.Unmarshal(b, &fc); err != nil {
		return nil, err
	}
	out := make([]Feature, 0, len(fc.Features))
	for _, f := range fc.Features {
		var polys []Polygon
		switch f.Geometry.Type {
		case "Polygon":
			var p Polygon
			if err := json.Unmarshal(f.Geometry.Coordinates, &p); err != nil {
				return nil, err
			}
			polys = []Polygon{p}
		case "MultiPolygon":
			if err := json.Unmarshal(f.Geometry.Coordinates, &polys); err != nil {
				return nil, err
			}
		}
		out = append(out, Feature{Props: f.Properties, Polys: polys})
	}
	return out, nil
}

func inRing(r Ring, lon, lat float64) bool {
	in := false
	n := len(r)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		xi, yi := r[i][0], r[i][1]
		xj, yj := r[j][0], r[j][1]
		if (yi > lat) != (yj > lat) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi {
			in = !in
		}
	}
	return in
}

// Contains: punto dentro de algún polígono (respetando huecos).
func Contains(polys []Polygon, lon, lat float64) bool {
	for _, p := range polys {
		if len(p) == 0 || !inRing(p[0], lon, lat) {
			continue
		}
		hole := false
		for _, h := range p[1:] {
			if inRing(h, lon, lat) {
				hole = true
				break
			}
		}
		if !hole {
			return true
		}
	}
	return false
}

// BBox de un conjunto de polígonos: minLon, minLat, maxLon, maxLat.
func BBox(polys []Polygon) [4]float64 {
	b := [4]float64{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
	for _, p := range polys {
		for _, pt := range p[0] {
			b[0] = math.Min(b[0], pt[0])
			b[1] = math.Min(b[1], pt[1])
			b[2] = math.Max(b[2], pt[0])
			b[3] = math.Max(b[3], pt[1])
		}
	}
	return b
}

// Centroid por área del polígono exterior más grande; si cae fuera, punto interior por muestreo.
func Centroid(polys []Polygon) (lon, lat float64) {
	best, bestA := -1, 0.0
	for i, p := range polys {
		if a := math.Abs(ringArea(p[0])); a > bestA {
			best, bestA = i, a
		}
	}
	if best < 0 {
		return 0, 0
	}
	r := polys[best][0]
	var cx, cy, a float64
	for i := 0; i < len(r)-1; i++ {
		f := r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1]
		cx += (r[i][0] + r[i+1][0]) * f
		cy += (r[i][1] + r[i+1][1]) * f
		a += f
	}
	if a != 0 {
		cx /= 3 * a
		cy /= 3 * a
	}
	if Contains(polys, cx, cy) {
		return cx, cy
	}
	pts := SamplePoints(polys, 0.01)
	if len(pts) > 0 {
		return pts[len(pts)/2][0], pts[len(pts)/2][1]
	}
	return cx, cy
}

func ringArea(r Ring) float64 {
	s := 0.0
	for i := 0; i < len(r)-1; i++ {
		s += r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1]
	}
	return s / 2
}

// SamplePoints: grilla regular de paso step (grados) dentro de los polígonos.
func SamplePoints(polys []Polygon, step float64) [][2]float64 {
	b := BBox(polys)
	var pts [][2]float64
	for y := b[1] + step/2; y < b[3]; y += step {
		for x := b[0] + step/2; x < b[2]; x += step {
			if Contains(polys, x, y) {
				pts = append(pts, [2]float64{x, y})
			}
		}
	}
	return pts
}

// PowerCell: celda nativa de NASA POWER (MERRA-2, 0.5° × 0.625°).
func PowerCell(lat, lon float64) (id string, clat, clon float64) {
	clat = math.Round(lat/0.5) * 0.5
	clon = math.Round(lon/0.625) * 0.625
	return CellID(clat, clon), clat, clon
}

// CellID estable para una celda.
func CellID(clat, clon float64) string {
	return "c" + ftoa(clat) + "_" + ftoa(clon)
}

func ftoa(f float64) string {
	s := strings.TrimRight(strings.TrimRight(strconvF(f), "0"), ".")
	return strings.ReplaceAll(s, "-", "m")
}

// Slug: texto sin tildes, minúsculas, guiones.
func Slug(s string) string {
	t := norm.NFD.String(strings.ToLower(s))
	var b strings.Builder
	dash := false
	for _, r := range t {
		switch {
		case unicode.Is(unicode.Mn, r):
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			dash = false
		default:
			if !dash && b.Len() > 0 {
				b.WriteRune('-')
				dash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

// Index de municipios para búsquedas.
type Index struct {
	List []*Municipio
	ByID map[string]*Municipio
}

// NewIndex ordena por nombre.
func NewIndex(ms []*Municipio) *Index {
	sort.Slice(ms, func(i, j int) bool { return ms[i].ID < ms[j].ID })
	ix := &Index{List: ms, ByID: map[string]*Municipio{}}
	for _, m := range ms {
		ix.ByID[m.ID] = m
	}
	return ix
}

// Locate: municipio que contiene el punto; si ninguno, el más cercano (≤ 30 km).
func (ix *Index) Locate(lat, lon float64) *Municipio {
	for _, m := range ix.List {
		if lon < m.BBox[0] || lon > m.BBox[2] || lat < m.BBox[1] || lat > m.BBox[3] {
			continue
		}
		if Contains(m.Polys, lon, lat) {
			return m
		}
	}
	var best *Municipio
	bd := 1e9
	for _, m := range ix.List {
		if d := Haversine(lat, lon, m.Lat, m.Lon); d < bd {
			best, bd = m, d
		}
	}
	if bd > 30 {
		return nil
	}
	return best
}

// Search por nombre (sin tildes). Devuelve hasta n coincidencias, exactas primero.
func (ix *Index) Search(q string, n int) []*Municipio {
	q = Slug(q)
	if q == "" {
		return nil
	}
	var exact, pre, sub []*Municipio
	for _, m := range ix.List {
		s := Slug(m.Name)
		switch {
		case s == q:
			exact = append(exact, m)
		case strings.HasPrefix(s, q):
			pre = append(pre, m)
		case strings.Contains(s, q) || strings.Contains(Slug(m.Name+" "+m.Dept), q):
			sub = append(sub, m)
		}
	}
	out := append(append(exact, pre...), sub...)
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// Haversine en km.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371.0
	p1, p2 := lat1*math.Pi/180, lat2*math.Pi/180
	dp, dl := (lat2-lat1)*math.Pi/180, (lon2-lon1)*math.Pi/180
	a := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * R * math.Asin(math.Sqrt(a))
}
