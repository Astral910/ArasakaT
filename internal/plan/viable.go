package plan

import (
	"fmt"
	"math"

	"fieldshift/internal/contract"
	"fieldshift/internal/fao56"
	"fieldshift/internal/sim"
)

// Ronda 8: ¿prospera este cultivo aquí? Con cualquier cultivo en cualquier lugar (una milpa en el desierto, un
// coco en Alaska) no basta con dar una fecha de cosecha: si la planta se muere o no llega a madurar se dice
// claro, con el porqué. Reglas (en orden):
//  1. Frío/calor: temperatura media del lugar (NASA POWER 2001–2025, corregida por altitud) contra el rango del
//     cultivo (FAO ECOCROP, aproximado). Perennes: todo el año; anuales: el mes más cálido (o el más fresco para
//     los de clima frío).
//  2. Helada: cultivos sensibles con Tmín ≤ 3 °C en el ciclo en la mitad o más de los años parecidos.
//  3. Agua: pérdida de la cosecha en 7 o más de cada 10 temporadas parecidas (aun con el riego indicado).
//  4. Calor insuficiente para madurar (grados-día).

type termico struct {
	min, max float64 // °C: media mínima y máxima para crecer
	helada   bool    // muere con helada
}

// rangos térmicos aproximados (FAO ECOCROP: rango óptimo-absoluto, simplificado)
var termicos = map[string]termico{
	"maize": {14, 34, true}, "bean": {13, 30, true}, "sorghum": {16, 36, true},
	"rice": {18, 36, true}, "wheat": {4, 27, false}, "barley": {3, 27, false}, "oats": {3, 26, false},
	"millet": {18, 37, true}, "quinoa": {4, 25, false}, "amaranth": {15, 34, true},
	"soybean": {15, 33, true}, "peanut": {18, 34, true}, "chickpea": {8, 30, false}, "lentil": {6, 28, false},
	"pea": {6, 25, false}, "cowpea": {18, 35, true}, "fava": {4, 24, false},
	"potato": {6, 25, false}, "sweetpotato": {17, 33, true}, "cassava": {19, 35, true},
	"carrot": {6, 27, false}, "onion": {8, 30, false}, "garlic": {4, 27, false}, "beet": {5, 27, false},
	"tomato": {13, 32, true}, "chili": {15, 33, true}, "cabbage": {5, 26, false}, "lettuce": {6, 25, false},
	"broccoli": {5, 25, false}, "spinach": {4, 24, false}, "cucumber": {16, 33, true}, "squash": {14, 33, true},
	"watermelon": {18, 35, true}, "melon": {18, 35, true}, "eggplant": {17, 34, true}, "strawberry": {8, 27, false},
	"cotton": {18, 36, true}, "sunflower": {12, 33, false}, "sugarcane": {20, 36, true}, "tobacco": {16, 33, true},
	"sesame": {20, 36, true}, "canola": {5, 26, false},
	"coffee": {15, 27, true}, "banana": {18, 35, true}, "cacao": {21, 33, true}, "avocado": {13, 30, true},
	"citrus": {13, 34, true}, "mango": {19, 36, true}, "pineapple": {20, 34, true}, "papaya": {20, 34, true},
	"grape": {10, 30, false}, "cardamom": {18, 30, true}, "oilpalm": {22, 34, true}, "olive": {12, 30, false},
	"tea": {13, 30, false}, "apple": {6, 24, false}, "coconut": {22, 34, true},
}

// temperaturas medias del lugar: anual y por mes ((Tmáx+Tmín)/2), de toda la serie
func climaMeses(s *sim.Site) (anual float64, mes [12]float64) {
	var sum [12]float64
	var n [12]int
	for i := 0; i < s.N && i < len(s.Tmax) && i < len(s.Tmin); i++ {
		m := int(s.Date(i).Month()) - 1
		sum[m] += (s.Tmax[i] + s.Tmin[i]) / 2
		n[m]++
	}
	tot, k := 0.0, 0
	for m := range mes {
		if n[m] > 0 {
			mes[m] = sum[m] / float64(n[m])
			tot += mes[m]
			k++
		}
	}
	if k > 0 {
		anual = tot / float64(k)
	}
	return
}

func viabilidad(a *siembraArgs, out *contract.SimSiembra, el fechaEval) {
	id := a.def.Main.ID
	nom, nomEN := nombreCultivo(id, false), nombreCultivo(id, true)
	v := &contract.Viabilidad{Ok: true}
	defer func() {
		out.Viable = v
		if !v.Ok && v.Codigo != "no_madura" { // el texto principal dice primero que no se va a poder cosechar
			if el.noMadura {
				v.Texto += " Además, aquí el calor no alcanza: el cultivo no madura bien."
				v.TextoEN += " Also, there is not enough heat here: the crop does not mature well."
			}
			out.Texto, out.TextoEN, out.Veredicto, out.Recomendable = v.Texto, v.TextoEN, "mala", false
		}
	}()
	no := func(cod, es, en string) { v.Ok, v.Codigo, v.Texto, v.TextoEN = false, cod, es, en }

	anual, mes := climaMeses(a.s)
	frio, calido := mes[0], mes[0]
	for _, t := range mes {
		frio, calido = math.Min(frio, t), math.Max(calido, t)
	}
	c := fao56.Crops[id]
	if tr, ok := termicos[id]; ok && anual != 0 {
		switch {
		case c.Perenne && anual < tr.min:
			no("frio", fmt.Sprintf("No se va a poder cosechar: aquí hace demasiado frío para el %s. La temperatura media es de %.0f °C y necesita más de %.0f °C todo el año; la planta no crece y se muere.", nom, anual, tr.min),
				fmt.Sprintf("It will not be harvested: it is far too cold here for %s. The average temperature is %.0f °C and it needs over %.0f °C all year; the plant does not grow and dies.", nomEN, anual, tr.min))
			return
		case c.Perenne && tr.helada && frio < tr.min-6:
			no("frio", fmt.Sprintf("No se va a poder cosechar: el mes más frío llega a %.0f °C de media y el %s no aguanta ese frío (necesita más de %.0f °C); se muere en el invierno.", frio, nom, tr.min-6),
				fmt.Sprintf("It will not be harvested: the coldest month averages %.0f °C and %s cannot survive that cold (needs over %.0f °C); it dies in winter.", frio, nomEN, tr.min-6))
			return
		case !c.Perenne && calido < tr.min:
			no("frio", fmt.Sprintf("No se va a poder cosechar: ni en el mes más cálido (%.0f °C de media) hace el calor que necesita el %s (más de %.0f °C); no llega a crecer.", calido, nom, tr.min),
				fmt.Sprintf("It will not be harvested: even the warmest month (%.0f °C average) is colder than %s needs (over %.0f °C); it does not grow.", calido, nomEN, tr.min))
			return
		case c.Perenne && anual > tr.max, !c.Perenne && frio > tr.max:
			t := anual
			if !c.Perenne {
				t = frio
			}
			no("calor", fmt.Sprintf("No se va a poder cosechar: aquí hace demasiado calor para el %s (%.0f °C de media; aguanta hasta ~%.0f °C). La planta se quema y no da cosecha.", nom, t, tr.max),
				fmt.Sprintf("It will not be harvested: it is too hot here for %s (%.0f °C average; it tolerates up to ~%.0f °C). The plant scorches and gives no harvest.", nomEN, t, tr.max))
			return
		case tr.helada && el.helada >= 0.5 && !el.noMadura: // si no madura, la helada es por el ciclo alargado: lo dice «no madura»
			no("helada", fmt.Sprintf("No se va a poder cosechar: en %.0f de cada 10 años parecidos cae una helada durante el ciclo y el %s se muere con la helada.", math.Round(el.helada*10), nom),
				fmt.Sprintf("It will not be harvested: in %.0f of 10 similar years a frost hits during the cycle and %s dies from frost.", math.Round(el.helada*10), nomEN))
			return
		}
	}
	if el.prob >= 0.7 {
		no("sequia", fmt.Sprintf("No se va a poder cosechar: la planta se muere de sed. En %.0f de cada 10 temporadas parecidas se pierde la cosecha (le faltan ~%.0f mm de agua), aun con el riego indicado.", math.Round(el.prob*10), el.deficit),
			fmt.Sprintf("It will not be harvested: the plant dies of thirst. In %.0f of 10 similar seasons the harvest is lost (it lacks ~%.0f mm of water), even with the stated irrigation.", math.Round(el.prob*10), el.deficit))
		return
	}
	if el.noMadura {
		no("no_madura", fmt.Sprintf("No se va a poder cosechar bien: al %s le falta calor para madurar aquí; el grano o el fruto no se llena antes de que termine la temporada.", nom),
			fmt.Sprintf("It will not be harvested properly: %s lacks the heat to mature here; the grain or fruit does not fill before the season ends.", nomEN))
	}
}
