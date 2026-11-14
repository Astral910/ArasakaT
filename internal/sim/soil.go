package sim

import (
	"math"

	"fieldshift/internal/data"
)

// KFactor erodabilidad (t ha h ha-1 MJ-1 mm-1), ecuación EPIC (Williams 1995) con arena, arcilla y C orgánico.
func KFactor(so data.Soil) float64 {
	san, cla := so.Sand, so.Clay
	sil := math.Max(0, 100-san-cla)
	c := so.OM / 1.724
	sn1 := 1 - san/100
	fcsand := 0.2 + 0.3*math.Exp(-0.256*san*(1-sil/100))
	fcli := math.Pow(sil/(cla+sil+1e-9), 0.3)
	forg := 1 - 0.25*c/(c+math.Exp(3.72-2.95*c))
	fhisand := 1 - 0.7*sn1/(sn1+math.Exp(-5.51+22.9*sn1))
	return 0.1317 * fcsand * fcli * forg * fhisand
}

// Parcela típica de ladera: longitud de pendiente 15 m; la pendiente media del municipio (SRTM) se limita a 3–20 %.
const slopeLenM = 15.0

// LSFactor RUSLE (McCool et al. 1987/1989).
func LSFactor(slopePct float64) float64 {
	sp := math.Max(3, math.Min(20, slopePct))
	th := math.Atan(sp / 100)
	m := 0.5
	if sp < 1 {
		m = 0.2
	} else if sp < 3.5 {
		m = 0.3
	} else if sp < 4.5 {
		m = 0.4
	}
	L := math.Pow(slopeLenM/22.13, m)
	var S float64
	if sp < 9 {
		S = 10.8*math.Sin(th) + 0.03
	} else {
		S = 16.8*math.Sin(th) - 0.50
	}
	return L * S
}

// Modelo simple de carbono orgánico (0–20 cm), tipo ICBM de un compartimento:
// ΔC = h·Cin − k(T)·C − pérdida por erosión. Aproximado: sirve para la dirección y el orden de magnitud.
const (
	soilMassT  = 2600.0 // t de suelo por ha en 0–20 cm (densidad aparente 1.3)
	humif      = 0.15   // coeficiente de humificación del residuo fresco
	kDecomp20  = 0.018  // descomposición anual a 20 °C
	carbonFrac = 0.45
)

// SOCFromOM t C/ha a partir de % de materia orgánica.
func SOCFromOM(om float64) float64 { return om / 1.724 / 100 * soilMassT }

// OMFromSOC % de materia orgánica a partir de t C/ha.
func OMFromSOC(soc float64) float64 { return soc / soilMassT * 100 * 1.724 }

// SoilStep avanza un año: residuo (t MS/ha), erosión (t/ha), temperatura media (°C).
func SoilStep(soc, residueT, rootsT, erosionT, tmean float64) float64 {
	in := humif * carbonFrac * (residueT + rootsT)
	k := kDecomp20 * math.Pow(2, (tmean-20)/10)
	conc := soc / soilMassT
	ero := erosionT * conc * 0.3 // el subsuelo (más pobre) reemplaza buena parte de lo perdido
	return math.Max(0.2*soc, soc+in-k*soc-ero)
}

// YieldSoilFactor efecto del suelo y del nitrógeno de leguminosas en el rendimiento del año n (aprox.):
// cada 0.5 % de MO ganada o perdida ≈ ±8 %; leguminosa de cobertura +5 %/año hasta +15 % (Buckles et al. 1998).
func YieldSoilFactor(dOM float64, legumeYears int, coverLegume bool) float64 {
	f := 1 + 0.16*dOM
	if coverLegume {
		f += math.Min(0.15, 0.05*float64(legumeYears))
	}
	return math.Max(0.6, math.Min(1.3, f))
}

// DefaultSoil suelo típico cuando SoilGrids no responde: franco arcilloso de ladera
// (rangos de la Clasificación de reconocimiento de suelos de Guatemala, Simmons et al. 1959; MAGA 2000).
func DefaultSoil(elev float64) data.Soil {
	s := data.Soil{Sand: 38, Clay: 28, OM: 2.5, Source: "Valor típico franco arcilloso de ladera (Simmons et al. 1959; MAGA). SoilGrids no respondió: revisar con análisis de suelo local."}
	if elev > 1800 { // altiplano: suelos volcánicos más orgánicos
		s.Sand, s.Clay, s.OM = 40, 22, 4.0
		s.Source = "Valor típico franco de altiplano volcánico (Simmons et al. 1959; MAGA). SoilGrids no respondió: revisar con análisis de suelo local."
	} else if elev < 300 { // costa y Petén bajos
		s.Sand, s.Clay, s.OM = 35, 32, 2.8
		s.Source = "Valor típico franco arcilloso de tierras bajas (Simmons et al. 1959; MAGA). SoilGrids no respondió: revisar con análisis de suelo local."
	}
	return s
}
