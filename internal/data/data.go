// Package data: tipos y lectura/escritura de los datos precalculados en /data.
package data

import (
	"compress/gzip"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Missing: valor faltante en series (NASA POWER usa -999).
const Missing = -999.0

// Climate: serie diaria de una celda NASA POWER.
type Climate struct {
	Cell   string    `json:"cell"`
	Lat    float64   `json:"lat"`
	Lon    float64   `json:"lon"`
	ElevM  float64   `json:"elev_m"`
	Start  string    `json:"start"` // YYYY-MM-DD
	Tmax   []float64 `json:"tmax"`
	Tmin   []float64 `json:"tmin"`
	RH     []float64 `json:"rh"`
	WS     []float64 `json:"ws"`
	RS     []float64 `json:"rs"` // MJ m-2 d-1
	PR     []float64 `json:"pr"` // mm d-1
	GW     []float64 `json:"gw"` // GWETROOT 0-1
	Source string    `json:"source"`
}

// StartTime fecha inicial.
func (c *Climate) StartTime() time.Time {
	t, _ := time.Parse("2006-01-02", c.Start)
	return t
}

// Index del día t (puede ser fuera de rango).
func (c *Climate) Index(t time.Time) int {
	return int(t.Sub(c.StartTime()).Hours() / 24)
}

// Date del índice i.
func (c *Climate) Date(i int) time.Time { return c.StartTime().AddDate(0, 0, i) }

// Len número de días.
func (c *Climate) Len() int { return len(c.PR) }

// LastValid último índice con lluvia y temperatura válidas.
func (c *Climate) LastValid() int {
	for i := len(c.PR) - 1; i >= 0; i-- {
		if c.PR[i] > Missing && c.Tmax[i] > Missing {
			return i
		}
	}
	return -1
}

// Fill rellena faltantes aislados con el valor anterior (o climatología simple).
func (c *Climate) Fill() {
	for _, s := range [][]float64{c.Tmax, c.Tmin, c.RH, c.WS, c.RS, c.PR, c.GW} {
		last := math.NaN()
		for i, v := range s {
			if v <= Missing {
				if !math.IsNaN(last) {
					s[i] = last
				}
				continue
			}
			last = v
		}
	}
}

// WriteGz guarda JSON gzip.
func WriteGz(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := gzip.NewWriter(f)
	if err := json.NewEncoder(zw).Encode(v); err != nil {
		return err
	}
	return zw.Close()
}

// ReadGz lee JSON gzip (o JSON plano si no termina en .gz).
func ReadGz(path string, v any) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if !strings.HasSuffix(path, ".gz") {
		return json.NewDecoder(f).Decode(v)
	}
	zr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer zr.Close()
	return json.NewDecoder(zr).Decode(v)
}

// WriteJSON guarda JSON compacto.
func WriteJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// ReadJSON lee JSON.
func ReadJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// R2 redondea a 2 decimales.
func R2(f float64) float64 { return math.Round(f*100) / 100 }

// R1 redondea a 1 decimal.
func R1(f float64) float64 { return math.Round(f*10) / 10 }

// ONI: índice El Niño oceánico por temporada de 3 meses.
type ONI struct {
	Source string             `json:"source"`
	Values map[string]float64 `json:"values"` // "2015-JJA": 1.5
}

// ENSOYear: estado ENSO de la temporada de lluvias (promedio JJA–JAS–ASO, cuando El Niño pega en la canícula y la Postrera).
func (o *ONI) ENSOYear(y int) (val float64, state string) {
	n := 0
	for _, s := range []string{"JJA", "JAS", "ASO"} {
		if v, ok := o.Values[itoa(y)+"-"+s]; ok {
			val += v
			n++
		}
	}
	if n == 0 {
		return 0, "neutral"
	}
	val /= float64(n)
	switch {
	case val >= 0.5:
		state = "nino"
	case val <= -0.5:
		state = "nina"
	default:
		state = "neutral"
	}
	return val, state
}

func itoa(i int) string {
	b, _ := json.Marshal(i)
	return string(b)
}

// CMIP6Deltas: cambios mensuales 2036–2045 vs 2005–2014 (NEX-GDDP-CMIP6).
type CMIP6Deltas struct {
	Source string       `json:"source"`
	Models []string     `json:"models"`
	Points []CMIP6Point `json:"points"`
}

// CMIP6Point deltas para un punto.
type CMIP6Point struct {
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	// Por escenario: 12 meses. PrRatio multiplicativo; Tmax/Tmin aditivos (°C).
	Scen map[string]MonthlyDelta `json:"scen"`
}

// MonthlyDelta 12 valores por variable + dispersión entre modelos.
type MonthlyDelta struct {
	PrRatio  [12]float64 `json:"pr_ratio"`
	TmaxAdd  [12]float64 `json:"tmax_add"`
	TminAdd  [12]float64 `json:"tmin_add"`
	PrSpread [12]float64 `json:"pr_spread"` // desviación entre modelos del ratio
}

// Nearest punto CMIP6 más cercano.
func (d *CMIP6Deltas) Nearest(lat, lon float64) *CMIP6Point {
	var best *CMIP6Point
	bd := math.Inf(1)
	for i := range d.Points {
		p := &d.Points[i]
		dd := (p.Lat-lat)*(p.Lat-lat) + (p.Lon-lon)*(p.Lon-lon)
		if dd < bd {
			best, bd = p, dd
		}
	}
	return best
}

// Soil: propiedades de suelo de referencia.
type Soil struct {
	Sand   float64 `json:"sand"` // %
	Clay   float64 `json:"clay"` // %
	OM     float64 `json:"om"`   // % materia orgánica
	Source string  `json:"source"`
}
