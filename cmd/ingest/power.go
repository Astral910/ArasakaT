package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	"fieldshift/internal/data"
	"fieldshift/internal/geo"
)

const powerParams = "T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN,PRECTOTCORR,GWETROOT"

// Inicio de la serie: la lluvia de POWER solo es consistente desde 2001 (ruptura de fuente antes).
const powerStart = "20010101"

func stepPower() error {
	ms, err := loadMunicipios()
	if err != nil {
		return err
	}
	cells := map[string][2]float64{}
	for _, m := range ms {
		id, clat, clon := geo.PowerCell(m.Lat, m.Lon)
		cells[id] = [2]float64{clat, clon}
	}
	var ids []string
	for id := range cells {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	end := time.Now().AddDate(0, 0, -1).Format("20060102")
	log.Printf("POWER: %d celdas", len(ids))
	errs := 0
	parallel(len(ids), func(i int) {
		id := ids[i]
		c := cells[id]
		url := fmt.Sprintf("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=%s&community=AG&latitude=%.3f&longitude=%.3f&start=%s&end=%s&format=JSON&time-standard=LST",
			powerParams, c[0], c[1], powerStart, end)
		b, err := get(url)
		if err != nil {
			log.Printf("POWER %s: %v", id, err)
			errs++
			return
		}
		cl, err := parsePower(b)
		if err != nil {
			log.Printf("POWER %s: %v", id, err)
			errs++
			return
		}
		cl.Cell, cl.Lat, cl.Lon = id, c[0], c[1]
		if err := data.WriteGz(p("climate", id+".json.gz"), cl); err != nil {
			log.Printf("POWER %s: %v", id, err)
		}
	})
	if errs > 0 {
		return fmt.Errorf("%d celdas fallaron", errs)
	}
	return nil
}

func parsePower(b []byte) (*data.Climate, error) {
	var r struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"`
		} `json:"geometry"`
		Properties struct {
			Parameter map[string]map[string]float64 `json:"parameter"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	pr := r.Properties.Parameter["PRECTOTCORR"]
	if len(pr) == 0 {
		return nil, fmt.Errorf("sin datos")
	}
	var days []string
	for d := range pr {
		days = append(days, d)
	}
	sort.Strings(days)
	cl := &data.Climate{Source: "NASA POWER daily, community AG (T2M_MAX, T2M_MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR, GWETROOT)"}
	t0, _ := time.Parse("20060102", days[0])
	cl.Start = t0.Format("2006-01-02")
	if len(r.Geometry.Coordinates) > 2 {
		cl.ElevM = r.Geometry.Coordinates[2]
	}
	n := len(days)
	col := func(k string) []float64 {
		m := r.Properties.Parameter[k]
		out := make([]float64, n)
		for i := 0; i < n; i++ {
			d := t0.AddDate(0, 0, i).Format("20060102")
			v, ok := m[d]
			if !ok || v <= -998 {
				out[i] = data.Missing
			} else {
				out[i] = data.R2(v)
			}
		}
		return out
	}
	cl.Tmax, cl.Tmin, cl.RH, cl.WS = col("T2M_MAX"), col("T2M_MIN"), col("RH2M"), col("WS2M")
	cl.RS, cl.PR, cl.GW = col("ALLSKY_SFC_SW_DWN"), col("PRECTOTCORR"), col("GWETROOT")
	return cl, nil
}

func stepONI() error {
	b, err := get("https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt")
	if err != nil {
		return err
	}
	o := data.ONI{Source: "NOAA CPC Oceanic Niño Index (ERSSTv5), oni.ascii.txt", Values: map[string]float64{}}
	for _, ln := range strings.Split(string(b), "\n") {
		f := strings.Fields(ln)
		if len(f) != 4 {
			continue
		}
		y, err := strconv.Atoi(f[1])
		if err != nil || y < 1995 {
			continue
		}
		v, _ := strconv.ParseFloat(f[3], 64)
		o.Values[fmt.Sprintf("%d-%s", y, f[0])] = v
	}
	return data.WriteJSON(p("oni.json"), o)
}
