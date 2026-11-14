package main

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"log"
	"math"
	"regexp"
	"strconv"
	"time"

	"fieldshift/internal/data"
)

// NDVI de MODIS Terra (MOD13Q1, 16 días, 250 m) desde NASA GIBS, invirtiendo la paleta oficial
// (colormaps/v1.3/MODIS_L3_NDVI.xml): cada color corresponde a un intervalo de 0.005 de NDVI.
// Respaldo cuando el servicio de ORNL DAAC no responde.
const gibsLayer = "MODIS_Terra_L3_NDVI_16Day"

func gibsColormap() (map[[3]uint8]float64, error) {
	b, err := cached(p("raw", "ndvi", "MODIS_L3_NDVI.xml"), "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml")
	if err != nil {
		return nil, err
	}
	re := regexp.MustCompile(`rgb="(\d+),(\d+),(\d+)" transparent="false" sourceValue="[^"]*" value="\[([-0-9.]+),([-0-9.]+)\)"`)
	cm := map[[3]uint8]float64{}
	for _, m := range re.FindAllStringSubmatch(string(b), -1) {
		r, _ := strconv.Atoi(m[1])
		g, _ := strconv.Atoi(m[2])
		bl, _ := strconv.Atoi(m[3])
		lo, _ := strconv.ParseFloat(m[4], 64)
		hi, _ := strconv.ParseFloat(m[5], 64)
		cm[[3]uint8{uint8(r), uint8(g), uint8(bl)}] = (lo + hi) / 2
	}
	if len(cm) < 50 {
		return nil, fmt.Errorf("paleta incompleta (%d)", len(cm))
	}
	return cm, nil
}

// gibsNDVI media de NDVI en una ventana de ±1.5 km alrededor del punto.
func gibsNDVI(cm map[[3]uint8]float64, lat, lon float64, date string) (float64, int, error) {
	const level = 8
	size := 288.0 / math.Exp2(level) // grados por tesela de 512 px
	col := int((lon + 180) / size)
	row := int((90 - lat) / size)
	url := fmt.Sprintf("https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/%s/default/%s/250m/%d/%d/%d.png", gibsLayer, date, level, row, col)
	b, err := cached(p("raw", "ndvi", fmt.Sprintf("gibs_%s_%d_%d.png", date, row, col)), url)
	if err != nil {
		return 0, 0, err
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return 0, 0, err
	}
	px := (lon + 180 - float64(col)*size) / size * 512
	py := (90 - lat - float64(row)*size) / size * 512
	half := int(math.Round(1.5 / 111 / (size / 512)))
	sum, n := 0.0, 0
	for y := int(py) - half; y <= int(py)+half; y++ {
		for x := int(px) - half; x <= int(px)+half; x++ {
			if v, ok := lookup(cm, img, x, y); ok {
				sum += v
				n++
			}
		}
	}
	if n == 0 {
		return 0, 0, fmt.Errorf("sin píxeles válidos")
	}
	return sum / float64(n), n, nil
}

func lookup(cm map[[3]uint8]float64, img image.Image, x, y int) (float64, bool) {
	if !(image.Point{x, y}.In(img.Bounds())) {
		return 0, false
	}
	r, g, b, a := img.At(x, y).RGBA()
	if a < 0x8000 {
		return 0, false
	}
	v, ok := cm[[3]uint8{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8)}]
	return v, ok
}

// stepNDVIGIBS NDVI de ago–sep (3 compuestos) por año 2001–2026 para los municipios héroe.
func stepNDVIGIBS() error {
	cm, err := gibsColormap()
	if err != nil {
		return err
	}
	for _, s := range ndviSites {
		series := map[string]float64{}
		type job struct{ date string }
		var dates []string
		for y := 2001; y <= 2026; y++ {
			for _, doy := range []int{225, 241, 257} { // compuestos de 16 días que cubren ago–sep
				d := time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, doy-1)
				dates = append(dates, d.Format("2006-01-02"))
			}
		}
		res := make([]float64, len(dates))
		parallel(len(dates), func(i int) {
			v, _, err := gibsNDVI(cm, s.Lat, s.Lon, dates[i])
			if err == nil {
				res[i] = v
			}
		})
		for i, d := range dates {
			if res[i] > 0 {
				series[d] = math.Round(res[i]*1000) / 1000
			}
		}
		if len(series) == 0 {
			return fmt.Errorf("GIBS sin datos para %s", s.ID)
		}
		if err := data.WriteJSON(p("ndvi", s.ID+".json"), map[string]any{"site": s.ID,
			"source": "MODIS/Terra MOD13Q1 NDVI 16 días 250 m vía NASA GIBS (" + gibsLayer + "), paleta MODIS_L3_NDVI invertida; media 3×3 km",
			"ndvi":   series}); err != nil {
			return err
		}
		log.Printf("NDVI GIBS %s: %d compuestos", s.ID, len(series))
	}
	return nil
}
