package geo

import (
	"encoding/json"
	"os"
	"strconv"
)

func strconvF(f float64) string { return strconv.FormatFloat(f, 'f', 3, 64) }

// Load lee municipios.json (meta) y municipios.geojson (polígonos).
func Load(metaPath, geoPath string) ([]*Municipio, error) {
	b, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, err
	}
	var ms []*Municipio
	if err := json.Unmarshal(b, &ms); err != nil {
		return nil, err
	}
	fs, err := ReadGeoJSON(geoPath)
	if err != nil {
		return nil, err
	}
	byID := map[string][]Polygon{}
	for _, f := range fs {
		id, _ := f.Props["id"].(string)
		byID[id] = f.Polys
	}
	for _, m := range ms {
		m.Polys = byID[m.ID]
	}
	return ms, nil
}
