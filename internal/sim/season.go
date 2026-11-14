package sim

import (
	"math"

	"fieldshift/internal/fao56"
)

// CropOpts condiciones de manejo para simular un cultivo.
type CropOpts struct {
	TAWFactor  float64 // incertidumbre del suelo (1 = valor central)
	Irrigation bool    // riego de auxilio
	Mulch      float64 // cobertura de rastrojo 0..1 (baja evaporación y escorrentía)
	CoverKcAdd float64 // Kc extra por cultivo de cobertura intercalado (competencia)
	CoverFrom  int     // día desde la siembra en que empieza la cobertura
	CN         float64 // número de curva base
}

// SeasonResult resultado FAO-56/FAO-33 de un cultivo en una temporada.
type SeasonResult struct {
	SowIdx      int
	ETc, ETa    float64
	Rain        float64
	Runoff      float64
	Irrig       float64
	Deficit     float64 // ETc − ETa (mm)
	YieldRatio  float64 // Ya/Ym
	StageDef    [4]float64
	WorstStage  int
	MaxDrySpell int
	FrostDays   int // días con Tmín ≤ 0 °C con el cultivo ya nacido
}

// Interception pérdida inicial diaria (mm) por intercepción y evaporación directa de lluvias pequeñas.
const Interception = 2.0

// RunCrop simula el balance hídrico diario en la zona radicular (FAO-56 cap. 8)
// y la respuesta del rendimiento por etapas (FAO-33).
func RunCrop(s *Site, c fao56.Crop, sow int, o CropOpts) SeasonResult {
	r := SeasonResult{SowIdx: sow}
	if sow < 0 || sow+c.Season() >= s.N {
		r.YieldRatio = math.NaN()
		return r
	}
	h := s.Hydro()
	zrCap := s.SoilDepth()
	tf := o.TAWFactor
	if tf == 0 {
		tf = 1
	}
	cn := o.CN
	if cn == 0 {
		cn = 78
	}
	cn -= 10 * o.Mulch // rastrojo: más infiltración
	var etaS, etcS [4]float64
	taw0 := h.TAWmm(math.Min(c.ZrAt(0), zrCap)) * tf
	dr := 0.3 * taw0
	irrigLeft := 0.0
	if o.Irrigation {
		irrigLeft = 120 // riego de auxilio: hasta ~6 riegos de 20 mm
	}
	dry := 0
	for d := 0; d < c.Season(); d++ {
		i := sow + d
		taw := h.TAWmm(math.Min(c.ZrAt(d), zrCap)) * tf
		raw := c.P * taw
		kc := c.KcAt(d)
		// fracción de suelo cubierto por el dosel: el rastrojo solo reduce la evaporación del suelo descubierto
		fc := math.Max(0, math.Min(1, (kc-c.Kc[0])/(c.Kc[1]-c.Kc[0]+1e-9)))
		kc -= 0.25 * o.Mulch * (1 - fc) // FAO-56 §7: el mulch orgánico baja ~5 % la evaporación por cada 10 % de cobertura
		if o.CoverKcAdd > 0 && d >= o.CoverFrom {
			kc += o.CoverKcAdd
		}
		etc := kc * s.ET0[i]
		p := s.PR[i]
		if p < DryDayMM {
			dry++
			if dry > r.MaxDrySpell {
				r.MaxDrySpell = dry
			}
		} else {
			dry = 0
		}
		ro := fao56.RunoffCN(p, cn)
		pe := math.Max(0, p-ro-Interception)
		irr := 0.0
		if o.Irrigation && dr > raw && irrigLeft > 0 {
			irr = math.Min(20, irrigLeft)
			irrigLeft -= irr
		}
		ks := fao56.Ks(dr, taw, raw)
		eta := ks * etc
		dr = dr - pe - irr + eta
		if dr < 0 { // percolación profunda
			dr = 0
		}
		if dr > taw {
			dr = taw
		}
		st := c.StageAt(d)
		if (st == 1 || st == 2) && s.Tmin[i] <= 0 { // helada con el cultivo en crecimiento o floración
			r.FrostDays++
		}
		etaS[st] += eta
		etcS[st] += etc
		r.ETc += etc
		r.ETa += eta
		r.Rain += p
		r.Runoff += ro
		r.Irrig += irr
	}
	r.Deficit = r.ETc - r.ETa
	r.YieldRatio = fao56.YieldRatio(c.Ky, etaS, etcS)
	if r.FrostDays > 0 && !c.IsCover { // helada: daño fuerte en el follaje (aproximado)
		r.YieldRatio *= math.Pow(0.7, math.Min(float64(r.FrostDays), 3))
	}
	worst := 0.0
	for st := 0; st < 4; st++ {
		r.StageDef[st] = etcS[st] - etaS[st]
		if etcS[st] > 0 {
			if f := c.Ky[st] * (1 - etaS[st]/etcS[st]); f > worst {
				worst, r.WorstStage = f, st
			}
		}
	}
	return r
}
