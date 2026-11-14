package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"sort"
	"sync"

	"fieldshift/internal/data"
	"fieldshift/internal/geo"
)

const gbBase = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/GTM/"

func stepGeo() error {
	adm2p := p("raw", "adm2.geojson")
	adm1p := p("raw", "adm1.geojson")
	if _, err := cached(adm2p, gbBase+"ADM2/geoBoundaries-GTM-ADM2_simplified.geojson"); err != nil {
		return err
	}
	if _, err := cached(adm1p, gbBase+"ADM1/geoBoundaries-GTM-ADM1_simplified.geojson"); err != nil {
		return err
	}
	f2, err := geo.ReadGeoJSON(adm2p)
	if err != nil {
		return err
	}
	f1, err := geo.ReadGeoJSON(adm1p)
	if err != nil {
		return err
	}
	var ms []*geo.Municipio
	seen := map[string]bool{}
	for _, f := range f2 {
		name, _ := f.Props["shapeName"].(string)
		lon, lat := geo.Centroid(f.Polys)
		dept := ""
		for _, d := range f1 {
			if geo.Contains(d.Polys, lon, lat) {
				dept, _ = d.Props["shapeName"].(string)
				break
			}
		}
		if dept == "" { // el más cercano por centroide
			bd := math.Inf(1)
			for _, d := range f1 {
				dl, da := geo.Centroid(d.Polys)
				if dd := geo.Haversine(lat, lon, da, dl); dd < bd {
					bd, dept = dd, d.Props["shapeName"].(string)
				}
			}
		}
		id := geo.Slug(name) + "-" + geo.Slug(dept)
		for k := 2; seen[id]; k++ {
			id = fmt.Sprintf("%s-%s-%d", geo.Slug(name), geo.Slug(dept), k)
		}
		seen[id] = true
		lat, lon = math.Round(lat*1e4)/1e4, math.Round(lon*1e4)/1e4
		cell, _, _ := geo.PowerCell(lat, lon)
		ms = append(ms, &geo.Municipio{ID: id, Name: name, Dept: dept, Lat: lat, Lon: lon,
			Cell: cell, Polys: f.Polys, BBox: geo.BBox(f.Polys)})
	}
	sort.Slice(ms, func(i, j int) bool { return ms[i].ID < ms[j].ID })
	return writeMunicipios(ms)
}

// writeMunicipios: municipios.json (meta) + municipios.geojson (geometría redondeada).
func writeMunicipios(ms []*geo.Municipio) error {
	if err := data.WriteJSON(p("municipios.json"), ms); err != nil {
		return err
	}
	type feat struct {
		Type     string         `json:"type"`
		ID       int            `json:"id"`
		Props    map[string]any `json:"properties"`
		Geometry map[string]any `json:"geometry"`
	}
	var feats []feat
	for i, m := range ms {
		var coords [][][][2]float64
		for _, pg := range m.Polys {
			var rings [][][2]float64
			for _, r := range pg {
				var rr [][2]float64
				for _, pt := range r {
					rr = append(rr, [2]float64{math.Round(pt[0]*1e4) / 1e4, math.Round(pt[1]*1e4) / 1e4})
				}
				rings = append(rings, rr)
			}
			coords = append(coords, rings)
		}
		feats = append(feats, feat{Type: "Feature", ID: i, Props: map[string]any{"id": m.ID, "name": m.Name, "dept": m.Dept},
			Geometry: map[string]any{"type": "MultiPolygon", "coordinates": coords}})
	}
	b, _ := json.Marshal(map[string]any{"type": "FeatureCollection", "features": feats})
	return os.WriteFile(p("municipios.geojson"), b, 0o644)
}

// loadMunicipios lee meta + geometría.
func loadMunicipios() ([]*geo.Municipio, error) {
	return geo.Load(p("municipios.json"), p("municipios.geojson"))
}

// ---- Relieve: SRTM vía AWS Terrain Tiles (terrarium) ----

const tz = 10

type tileKey struct{ x, y int }

var (
	tileCache = map[tileKey]image.Image{}
	tileMu    sync.Mutex
)

func tileXY(lat, lon float64) (fx, fy float64) {
	n := math.Exp2(tz)
	fx = (lon + 180) / 360 * n
	lr := lat * math.Pi / 180
	fy = (1 - math.Log(math.Tan(lr)+1/math.Cos(lr))/math.Pi) / 2 * n
	return
}

func elevAt(fx, fy float64) (float64, error) {
	k := tileKey{int(fx), int(fy)}
	tileMu.Lock()
	img, ok := tileCache[k]
	tileMu.Unlock()
	if !ok {
		b, err := cached(p("raw", "terrain", fmt.Sprintf("%d_%d_%d.png", tz, k.x, k.y)),
			fmt.Sprintf("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png", tz, k.x, k.y))
		if err != nil {
			return 0, err
		}
		img, err = png.Decode(bytes.NewReader(b))
		if err != nil {
			return 0, err
		}
		tileMu.Lock()
		tileCache[k] = img
		tileMu.Unlock()
	}
	px := int((fx - float64(k.x)) * 256)
	py := int((fy - float64(k.y)) * 256)
	r, g, b, _ := img.At(px, py).RGBA()
	return float64(r>>8)*256 + float64(g>>8) + float64(b>>8)/256 - 32768, nil
}

func stepTerrain() error {
	ms, err := loadMunicipios()
	if err != nil {
		return err
	}
	// precarga de teselas en paralelo
	keys := map[tileKey]bool{}
	for _, m := range ms {
		for _, c := range [][2]float64{{m.BBox[1], m.BBox[0]}, {m.BBox[3], m.BBox[2]}} {
			_ = c
		}
		x0, y1 := tileXY(m.BBox[1], m.BBox[0])
		x1, y0 := tileXY(m.BBox[3], m.BBox[2])
		for x := int(x0); x <= int(x1); x++ {
			for y := int(y0); y <= int(y1); y++ {
				keys[tileKey{x, y}] = true
			}
		}
	}
	var kl []tileKey
	for k := range keys {
		kl = append(kl, k)
	}
	parallel(len(kl), func(i int) { elevAt(float64(kl[i].x)+0.5, float64(kl[i].y)+0.5) })
	for _, m := range ms {
		pts := geo.SamplePoints(m.Polys, 0.01)
		if len(pts) == 0 {
			pts = [][2]float64{{m.Lon, m.Lat}}
		}
		var es, ss []float64
		for _, pt := range pts {
			fx, fy := tileXY(pt[1], pt[0])
			e, err := elevAt(fx, fy)
			if err != nil {
				return err
			}
			d := 1.0 / 256
			ex1, _ := elevAt(fx+d, fy)
			ex0, _ := elevAt(fx-d, fy)
			ey1, _ := elevAt(fx, fy+d)
			ey0, _ := elevAt(fx, fy-d)
			pix := 156543.03 * math.Cos(pt[1]*math.Pi/180) / math.Exp2(tz)
			dzdx := (ex1 - ex0) / (2 * pix)
			dzdy := (ey1 - ey0) / (2 * pix)
			es = append(es, math.Max(e, 0))
			ss = append(ss, 100*math.Hypot(dzdx, dzdy))
		}
		sort.Float64s(es)
		m.ElevM = math.Round(es[len(es)/2])
		sum := 0.0
		for _, s := range ss {
			sum += s
		}
		m.SlopePct = data.R1(sum / float64(len(ss)))
	}
	return data.WriteJSON(p("municipios.json"), ms)
}
