// Package valid: validación del motor contra sequías documentadas en el Corredor Seco (2001–2025).
package valid

import "math"

// Drought sequía documentada que afectó la Primera o la canícula en el oriente de Guatemala.
type Drought struct {
	Year   int    `json:"year"`
	Event  string `json:"event"`
	Source string `json:"source"`
}

// Documented lista examen (no se usa para calibrar el motor).
var Documented = []Drought{
	{2001, "Canícula prolongada; crisis alimentaria en Jocotán y Camotán", "FAO/PMA 2001; SESAN"},
	{2009, "El Niño: sequía y declaratoria de calamidad pública", "MAGA/SESAN 2009; FEWS NET"},
	{2012, "Canícula irregular con pérdidas de Primera en el oriente", "FEWS NET Guatemala 2012"},
	{2014, "Canícula prolongada: estado de calamidad en 16 departamentos", "MAGA 2014; FEWS NET"},
	{2015, "El Niño fuerte: pérdidas de maíz y frijol de Primera", "FEWS NET 2015; PMA"},
	{2018, "Canícula prolongada en el Corredor Seco", "FEWS NET 2018; MAGA"},
	{2019, "Lluvias irregulares y pérdidas de Primera", "FEWS NET 2019; PMA"},
	{2023, "El Niño: déficit de lluvias en la Primera", "FEWS NET 2023"},
}

// IsDocumented año en la lista.
func IsDocumented(y int) bool {
	for _, d := range Documented {
		if d.Year == y {
			return true
		}
	}
	return false
}

// YearFlag resultado del motor para un año.
type YearFlag struct {
	Year     int
	Detected bool
}

// Result tabla de validación.
type Result struct {
	Hits, Misses, FalseAlarms, CorrectNeg int
	Total                                 int // documentadas en el periodo evaluado
	Years                                 []Row
	HitRate                               float64
}

// Row fila por año.
type Row struct {
	Year       int  `json:"year"`
	Documented bool `json:"documented"`
	Detected   bool `json:"detected"`
}

// Score compara las detecciones del motor con la lista documentada.
func Score(flags []YearFlag) Result {
	var r Result
	for _, f := range flags {
		doc := IsDocumented(f.Year)
		r.Years = append(r.Years, Row{f.Year, doc, f.Detected})
		switch {
		case doc && f.Detected:
			r.Hits++
		case doc && !f.Detected:
			r.Misses++
		case !doc && f.Detected:
			r.FalseAlarms++
		default:
			r.CorrectNeg++
		}
	}
	r.Total = r.Hits + r.Misses
	if r.Total > 0 {
		r.HitRate = float64(r.Hits) / float64(r.Total)
	}
	return r
}

// NDVIYear NDVI medio de ago–sep de un año y su anomalía.
type NDVIYear struct {
	Year     int     `json:"year"`
	NDVI     float64 `json:"ndvi"`
	Z        float64 `json:"z"`
	Low      bool    `json:"bajo"`        // z ≤ −0.8: vegetación estresada
	Engine   float64 `json:"motor_ratio"` // Ya/Ym del motor (S0)
	Detected bool    `json:"motor_detecta"`
}

// NDVIResult comparación independiente motor ↔ satélite.
type NDVIResult struct {
	Years       []NDVIYear `json:"anios"`
	Correlation float64    `json:"correlacion"` // Pearson entre NDVI y Ya/Ym del motor
	LowYears    int        `json:"anios_ndvi_bajo"`
	Agree       int        `json:"coinciden"` // NDVI bajo y motor detecta
	DocLow      int        `json:"documentadas_con_ndvi_bajo"`
	Source      string     `json:"fuente"`
}

// CompareNDVI calcula anomalías de NDVI y su acuerdo con el motor y con la lista documentada.
func CompareNDVI(ndvi map[int]float64, engine map[int]float64, detected map[int]bool, source string) NDVIResult {
	r := NDVIResult{Source: source}
	var ys []int
	for y := range ndvi {
		if _, ok := engine[y]; ok {
			ys = append(ys, y)
		}
	}
	sortInts(ys)
	if len(ys) < 5 {
		return r
	}
	var m, sd float64
	for _, y := range ys {
		m += ndvi[y]
	}
	m /= float64(len(ys))
	for _, y := range ys {
		sd += (ndvi[y] - m) * (ndvi[y] - m)
	}
	sd = sqrt(sd / float64(len(ys)))
	var em, a, b, c float64
	for _, y := range ys {
		em += engine[y]
	}
	em /= float64(len(ys))
	for _, y := range ys {
		z := 0.0
		if sd > 0 {
			z = (ndvi[y] - m) / sd
		}
		row := NDVIYear{Year: y, NDVI: math.Round(ndvi[y]*1000) / 1000, Z: round2(z), Low: z <= -0.8, Engine: round2(engine[y]), Detected: detected[y]}
		r.Years = append(r.Years, row)
		if row.Low {
			r.LowYears++
			if row.Detected {
				r.Agree++
			}
			if IsDocumented(y) {
				r.DocLow++
			}
		}
		a += (ndvi[y] - m) * (engine[y] - em)
		b += (ndvi[y] - m) * (ndvi[y] - m)
		c += (engine[y] - em) * (engine[y] - em)
	}
	if b > 0 && c > 0 {
		r.Correlation = round2(a / sqrt(b*c))
	}
	return r
}
