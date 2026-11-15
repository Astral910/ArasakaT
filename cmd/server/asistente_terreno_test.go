package main

import "testing"

func TestElegirTerreno(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	ps := []map[string]any{
		{"id": "a", "lat": 14.82, "lon": -89.39, "actualizado": "2026-11-10T10:00:00Z"},
		{"id": "b", "lat": 14.63, "lon": -90.51, "actualizado": "2026-11-14T10:00:00Z"},
	}
	casos := []struct {
		nombre   string
		ps       []map[string]any
		lat, lon *float64
		quiero   string
	}{
		{"sin terrenos", nil, nil, nil, ""},
		{"uno solo", ps[:1], f(0), f(0), "a"},
		{"el más cercano al lugar de la sesión", ps, f(14.83), f(-89.40), "a"},
		{"sin lugar: el último que se tocó", ps, nil, nil, "b"},
		{"lugar lejos de todos: el último que se tocó", ps, f(40), f(-3), "b"},
	}
	for _, c := range casos {
		if got := elegirTerreno(c.ps, c.lat, c.lon); got != c.quiero {
			t.Errorf("%s: %q, quiero %q", c.nombre, got, c.quiero)
		}
	}
}
