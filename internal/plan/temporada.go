package plan

import (
	"encoding/json"
	"strings"

	"fieldshift/internal/contract"
	"fieldshift/internal/geo"
)

// Primera y Postrera (ronda 6): nombres de las temporadas de Centroamérica. Fuera de ella el plan usa un texto
// neutro: «temporada de lluvias» con una sola temporada, «temporada principal» y «segunda temporada» con dos.

var paisesCA = map[string]bool{"GT": true, "BZ": true, "SV": true, "HN": true, "NI": true, "CR": true, "PA": true}

// Centroamerica si el lugar está en Centroamérica (Guatemala precalculada, código de país o, sin código, la caja
// del istmo de Tehuantepec a Panamá).
func Centroamerica(m *geo.Municipio) bool {
	if !m.Global {
		return true
	}
	if p := strings.ToUpper(m.Pais); p != "" {
		return paisesCA[p]
	}
	return m.Lat >= 7 && m.Lat <= 18.5 && m.Lon >= -92.5 && m.Lon <= -77
}

// reemplazos de nombres de temporada (con mayúscula: las claves "primera"/"postrera" del JSON no se tocan).
func reemplazoTemporadas(en, bimodal bool) *strings.Replacer {
	if en {
		pri, Pri := "main season", "Main season"
		if !bimodal {
			pri, Pri = "rainy season", "Rainy season"
		}
		return strings.NewReplacer(
			"Primera (first season)", Pri, "Postrera (second season)", "Second season",
			"Primera planting", Pri+" planting", "Postrera planting", "Second-season planting",
			"Primera:", Pri+":", "Postrera:", "Second season:",
			"next Primera", "next "+pri, "if Primera fails", "if the "+pri+" fails", "in Primera", "in the "+pri,
			"in Postrera", "in the second season", "for Postrera", "for the second season", "Postrera rains", "second-season rains",
			"Postrera onset", "Second-season onset", "Dry Postrera", "Dry second season", "a Postrera", "a second season",
			"the Postrera season", "the second season", "Postrera season", "second season",
			"Primera", pri, "Postrera", "second season")
	}
	pri, Pri := "temporada principal", "Temporada principal"
	if !bimodal {
		pri, Pri = "temporada de lluvias", "Temporada de lluvias"
	}
	return strings.NewReplacer(
		"Siembra de Primera", "Siembra de la "+pri, "Siembra de Postrera", "Siembra de la segunda temporada",
		"Primera:", Pri+":", "Postrera:", "Segunda temporada:",
		"la Primera", "la "+pri, "de Primera", "de la "+pri, "en Primera", "en la "+pri, "próxima Primera", "próxima "+pri,
		"la Postrera", "la segunda temporada", "de Postrera", "de la segunda temporada", "en Postrera", "en la segunda temporada",
		"Primera", Pri, "Postrera", "Segunda temporada")
}

// neutraTemporadas cambia Primera/Postrera por el texto neutro en todos los textos del plan.
func neutraTemporadas(p contract.Plan, en, bimodal bool) contract.Plan {
	b, err := json.Marshal(p)
	if err != nil {
		return p
	}
	s := reemplazoTemporadas(en, bimodal).Replace(string(b))
	var o contract.Plan
	if json.Unmarshal([]byte(s), &o) != nil {
		return p
	}
	return o
}

// UnirNombre une las partes del nombre de un lugar con ", " sin repetir (ronda 6: «Xenacoj, Xenacoj», «Chile,
// Chile»): se salta la parte vacía, la igual a una anterior y la que ya es el final de una anterior
// («Santo Domingo Xenacoj, Xenacoj»).
func UnirNombre(partes ...string) string {
	var out []string
	for _, p := range partes {
		for _, q := range strings.Split(p, ",") {
			q = strings.TrimSpace(q)
			if q == "" {
				continue
			}
			rep := false
			for _, o := range out {
				lo, lq := strings.ToLower(o), strings.ToLower(q)
				if lo == lq || strings.HasSuffix(lo, " "+lq) || strings.HasPrefix(lo, lq+" ") {
					rep = true
					break
				}
			}
			if !rep {
				out = append(out, q)
			}
		}
	}
	return strings.Join(out, ", ")
}
