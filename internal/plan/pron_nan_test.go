package plan

import (
	"fmt"
	"math"
	"reflect"
	"testing"

	"fieldshift/internal/contract"
)

func buscarNaN(v reflect.Value, ruta string, out *[]string) {
	switch v.Kind() {
	case reflect.Ptr, reflect.Interface:
		if !v.IsNil() {
			buscarNaN(v.Elem(), ruta, out)
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Type().Field(i).IsExported() {
				buscarNaN(v.Field(i), ruta+"."+v.Type().Field(i).Name, out)
			}
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < v.Len(); i++ {
			buscarNaN(v.Index(i), fmt.Sprintf("%s[%d]", ruta, i), out)
		}
	case reflect.Map:
		for _, k := range v.MapKeys() {
			buscarNaN(v.MapIndex(k), fmt.Sprintf("%s[%v]", ruta, k), out)
		}
	case reflect.Float32, reflect.Float64:
		if f := v.Float(); math.IsNaN(f) || math.IsInf(f, 0) {
			*out = append(*out, ruta)
		}
	}
}

// Pronóstico en clima frío o hemisferio sur (Atacama, Flevoland): el ciclo pasa del 31 de diciembre del año
// análogo. Antes RunCrop daba NaN, el JSON salía vacío y la web mostraba el ejemplo ilustrativo.
func TestSimulatePronSinNaN(t *testing.T) {
	e := engine(t)
	for _, ll := range [][2]float64{{-23.5, -69.2}, {52.3, 5.6}} {
		id := fmt.Sprintf("g_%.2f_%.2f", ll[0], ll[1])
		tl, err := e.Simulate(contract.SimRequest{Plan: contract.PlanRequest{MunicipioID: id, Cultivo: "sorgo", Lat: &ll[0], Lon: &ll[1], Idioma: "en"}, Estrategia: "S2", Escenario: "pronostico", Percentil: "p50", Anios: 1, Semilla: 2026})
		if err != nil {
			t.Skip(id, err) // sin red ni caché del sitio global
		}
		var out []string
		buscarNaN(reflect.ValueOf(tl), "tl", &out)
		if len(out) > 0 {
			t.Errorf("%s: NaN/Inf en %v", id, out[:min(8, len(out))])
		}
	}
}
