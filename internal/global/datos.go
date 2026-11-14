package global

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"sort"
	"strings"
	"time"

	"fieldshift/internal/data"
)

const powerParams = "T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN,PRECTOTCORR,GWETROOT"

// SrcPower cita de la serie diaria.
const SrcPower = "NASA POWER daily, community AG (T2M_MAX, T2M_MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR, GWETROOT), 2001 → ayer, bajada bajo demanda"

// PowerCell celda NASA POWER (0.5° × 0.625°) del punto: los puntos cercanos comparten la descarga.
func PowerCell(lat, lon float64) (string, float64, float64) {
	clat := math.Round(lat/0.5) * 0.5
	clon := math.Round(lon/0.625) * 0.625
	return fmt.Sprintf("g%.1f_%.3f", clat, clon), clat, clon
}

// Power serie diaria 2001 → ayer de NASA POWER en una sola petición (caché en disco; se renueva cada 7 días,
// y si la renovación falla se usa la copia vieja).
func (c *Client) Power(lat, lon float64) (*data.Climate, error) {
	id, clat, clon := PowerCell(lat, lon)
	path := c.Path("power", id+".json.gz")
	defer c.lock(path)()
	var old *data.Climate
	if st, err := os.Stat(path); err == nil {
		var cl data.Climate
		if data.ReadGz(path, &cl) == nil && len(cl.PR) > 0 {
			if time.Since(st.ModTime()) < 7*24*time.Hour {
				return &cl, nil
			}
			old = &cl
		}
	}
	end := time.Now().AddDate(0, 0, -1).Format("20060102")
	url := fmt.Sprintf("%s?parameters=%s&community=AG&latitude=%.3f&longitude=%.3f&start=20010101&end=%s&format=JSON&time-standard=LST",
		c.PowerURL, powerParams, clat, clon, end)
	b, err := c.Get(url, 2)
	if err != nil {
		if old != nil {
			return old, nil
		}
		return nil, fmt.Errorf("NASA POWER: %w", err)
	}
	cl, err := ParsePower(b)
	if err != nil {
		if old != nil {
			return old, nil
		}
		return nil, err
	}
	cl.Cell, cl.Lat, cl.Lon = id, clat, clon
	_ = data.WriteGz(path, cl)
	return cl, nil
}

// ParsePower convierte la respuesta JSON de POWER (mismo formato que cmd/ingest).
func ParsePower(b []byte) (*data.Climate, error) {
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
		return nil, fmt.Errorf("NASA POWER sin datos")
	}
	var days []string
	for d := range pr {
		days = append(days, d)
	}
	sort.Strings(days)
	cl := &data.Climate{Source: SrcPower}
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
			v, ok := m[t0.AddDate(0, 0, i).Format("20060102")]
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

// Soil ISRIC SoilGrids 2.0 (0–30 cm) con 3 intentos; si el punto cae en ciudad o agua (sin dato) prueba
// puntos vecinos a ~5 km. Error si no responde (el motor usa valores por textura).
func (c *Client) Soil(lat, lon float64) (data.Soil, error) {
	var last error
	for k, o := range [][2]float64{{0, 0}, {0.05, 0}, {-0.05, 0}, {0, 0.05}, {0, -0.05}} {
		s, err := c.soilAt(lat+o[0], lon+o[1])
		if err == nil {
			if k > 0 {
				s.Source = "ISRIC SoilGrids 2.0 (0–30 cm, media) en un punto vecino a ~5 km (el punto cae en ciudad o agua)"
			}
			return s, nil
		}
		last = err
		if !strings.Contains(err.Error(), "sin dato") {
			break // sin red o servicio caído: no insistir
		}
	}
	return data.Soil{}, last
}

func (c *Client) soilAt(lat, lon float64) (data.Soil, error) {
	url := fmt.Sprintf("%s?lon=%.4f&lat=%.4f&property=clay&property=sand&property=soc&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean", c.SoilURL, lon, lat)
	b, err := c.Cached("suelo", CellKey(lat, lon)+".json", url, 3)
	if err != nil {
		return data.Soil{}, fmt.Errorf("SoilGrids: %w", err)
	}
	var r struct {
		Properties struct {
			Layers []struct {
				Name   string `json:"name"`
				Depths []struct {
					Values struct {
						Mean *float64 `json:"mean"`
					} `json:"values"`
				} `json:"depths"`
			} `json:"layers"`
		} `json:"properties"`
	}
	if json.Unmarshal(b, &r) != nil || len(r.Properties.Layers) == 0 {
		_ = os.Remove(c.Path("suelo", CellKey(lat, lon)+".json"))
		return data.Soil{}, fmt.Errorf("SoilGrids: respuesta sin capas")
	}
	vals := map[string]float64{}
	for _, l := range r.Properties.Layers {
		s, n := 0.0, 0
		for _, d := range l.Depths {
			if d.Values.Mean != nil {
				s += *d.Values.Mean
				n++
			}
		}
		if n > 0 {
			vals[l.Name] = s / float64(n)
		}
	}
	if vals["clay"] == 0 || vals["sand"] == 0 {
		return data.Soil{}, fmt.Errorf("SoilGrids: sin dato en el punto (agua, ciudad o roca)")
	}
	return data.Soil{Clay: data.R1(vals["clay"] / 10), Sand: data.R1(vals["sand"] / 10), OM: data.R2(vals["soc"] / 100 * 1.724),
		Source: "ISRIC SoilGrids 2.0 (0–30 cm, media) en el punto"}, nil
}

// ElevSlope altitud (m) y pendiente media (%) alrededor del punto (≈ 1 km) con SRTM de AWS Terrain Tiles (terrarium, zoom 12).
func (c *Client) ElevSlope(lat, lon float64) (float64, float64, error) {
	const z = 12
	n := math.Exp2(z)
	tile := func(la, lo float64) (float64, float64) {
		fx := (lo + 180) / 360 * n
		lr := la * math.Pi / 180
		fy := (1 - math.Log(math.Tan(lr)+1/math.Cos(lr))/math.Pi) / 2 * n
		return fx, fy
	}
	imgs := map[[2]int]image.Image{}
	elev := func(fx, fy float64) (float64, error) {
		k := [2]int{int(fx), int(fy)}
		img, ok := imgs[k]
		if !ok {
			b, err := c.Cached("relieve", fmt.Sprintf("%d_%d_%d.png", z, k[0], k[1]), fmt.Sprintf("%s/%d/%d/%d.png", c.TerrainURL, z, k[0], k[1]), 2)
			if err != nil {
				return 0, err
			}
			img, err = png.Decode(bytes.NewReader(b))
			if err != nil {
				return 0, err
			}
			imgs[k] = img
		}
		px := min(255, int((fx-float64(k[0]))*256))
		py := min(255, int((fy-float64(k[1]))*256))
		r, g, bb, _ := img.At(px, py).RGBA()
		return float64(r>>8)*256 + float64(g>>8) + float64(bb>>8)/256 - 32768, nil
	}
	fx, fy := tile(lat, lon)
	e0, err := elev(fx, fy)
	if err != nil {
		return 0, 0, fmt.Errorf("relieve: %w", err)
	}
	pix := 156543.03 * math.Cos(lat*math.Pi/180) / n // m por píxel
	d := 1.0 / 256
	var ss []float64
	for _, o := range [][2]float64{{0, 0}, {-8, -8}, {8, -8}, {-8, 8}, {8, 8}, {0, 10}, {10, 0}, {0, -10}, {-10, 0}} {
		x, y := fx+o[0]*d, fy+o[1]*d
		ex1, e1 := elev(x+d, y)
		ex0, e2 := elev(x-d, y)
		ey1, e3 := elev(x, y+d)
		ey0, e4 := elev(x, y-d)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil {
			continue
		}
		ss = append(ss, 100*math.Hypot((ex1-ex0)/(2*pix), (ey1-ey0)/(2*pix)))
	}
	sum := 0.0
	for _, s := range ss {
		sum += s
	}
	slope := 0.0
	if len(ss) > 0 {
		slope = sum / float64(len(ss))
	}
	return math.Round(math.Max(e0, 0)), data.R1(slope), nil
}

// Lugar nombre del lugar (OpenStreetMap Nominatim, inverso): localidad, región y código de país.
type Lugar struct {
	Nombre, Region, Pais, PaisNombre string
}

// Reverse nombre del punto (caché). Error si no hay red: el motor muestra las coordenadas.
func (c *Client) Reverse(lat, lon float64) (Lugar, error) {
	url := fmt.Sprintf("%s?format=jsonv2&lat=%.4f&lon=%.4f&zoom=10&accept-language=es", c.GeocodeURL, lat, lon)
	b, err := c.Cached("lugar", CellKey(lat, lon)+".json", url, 2)
	if err != nil {
		return Lugar{}, err
	}
	var r struct {
		Name    string            `json:"name"`
		Address map[string]string `json:"address"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return Lugar{}, err
	}
	a := r.Address
	l := Lugar{Region: first(a["state"], a["region"], a["province"], a["county"]), PaisNombre: a["country"]}
	l.Pais = upper(a["country_code"])
	l.Nombre = first(a["city"], a["town"], a["village"], a["municipality"], a["county"], r.Name, a["state"])
	if l.Nombre == "" && l.PaisNombre == "" {
		return l, fmt.Errorf("sin nombre (mar o zona deshabitada)")
	}
	return l, nil
}

func first(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func upper(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'a' && b[i] <= 'z' {
			b[i] -= 32
		}
	}
	return string(b)
}

// CMIP6 modelos de Open-Meteo Climate API (HighResMIP, ~10–50 km).
var CMIP6Models = []string{"EC_Earth3P_HR", "MRI_AGCM3_2_S", "MPI_ESM1_2_XR"}

// SrcClimate cita.
const SrcClimate = "Open-Meteo Climate API (CMIP6 HighResMIP: EC-Earth3P-HR, MRI-AGCM3-2-S, MPI-ESM1-2-XR; escenario de alta emisión), cambios mensuales 2031–2050 vs 2006–2025; SSP2-4.5 ≈ 0.8 × el cambio (IPCC AR6, tabla SPM.1)"

// ClimateDeltas cambios mensuales a 2040 (media de modelos) para ssp585 y ssp245 (escalado).
func (c *Client) ClimateDeltas(lat, lon float64) (*data.CMIP6Point, error) {
	url := fmt.Sprintf("%s?latitude=%.3f&longitude=%.3f&start_date=2006-01-01&end_date=2050-12-31&models=%s&daily=temperature_2m_max,temperature_2m_min,precipitation_sum",
		c.ClimateURL, lat, lon, join(CMIP6Models))
	b, err := c.Cached("cmip6", CellKey(math.Round(lat*4)/4, math.Round(lon*4)/4)+".json", url, 2)
	if err != nil {
		return nil, fmt.Errorf("Open-Meteo Climate: %w", err)
	}
	var r struct {
		Daily map[string]json.RawMessage `json:"daily"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	var times []string
	_ = json.Unmarshal(r.Daily["time"], &times)
	type acc struct {
		h, f   [12]float64
		nh, nf [12]float64
	}
	var md data.MonthlyDelta
	var ratios [12][]float64
	nm := 0
	for _, m := range CMIP6Models {
		var tx, tn, pr []*float64
		_ = json.Unmarshal(r.Daily["temperature_2m_max_"+m], &tx)
		_ = json.Unmarshal(r.Daily["temperature_2m_min_"+m], &tn)
		_ = json.Unmarshal(r.Daily["precipitation_sum_"+m], &pr)
		if len(tx) != len(times) || len(pr) != len(times) || len(tn) != len(times) {
			continue
		}
		var ax, an, ap acc
		for i, t := range times {
			if tx[i] == nil || tn[i] == nil || pr[i] == nil || len(t) < 7 {
				continue
			}
			var y, mo int
			fmt.Sscanf(t, "%d-%d", &y, &mo)
			k := mo - 1
			switch {
			case y >= 2006 && y <= 2025:
				ax.h[k] += *tx[i]
				an.h[k] += *tn[i]
				ap.h[k] += *pr[i]
				ax.nh[k]++
			case y >= 2031 && y <= 2050:
				ax.f[k] += *tx[i]
				an.f[k] += *tn[i]
				ap.f[k] += *pr[i]
				ax.nf[k]++
			}
		}
		ok := true
		for k := 0; k < 12; k++ {
			if ax.nh[k] == 0 || ax.nf[k] == 0 {
				ok = false
			}
		}
		if !ok {
			continue
		}
		nm++
		for k := 0; k < 12; k++ {
			md.TmaxAdd[k] += ax.f[k]/ax.nf[k] - ax.h[k]/ax.nh[k]
			md.TminAdd[k] += an.f[k]/ax.nf[k] - an.h[k]/ax.nh[k]
			ph, pf := ap.h[k]/ax.nh[k], ap.f[k]/ax.nf[k]
			rt := 1.0
			if ph > 0.05 {
				rt = math.Max(0.5, math.Min(1.6, pf/ph))
			}
			ratios[k] = append(ratios[k], rt)
		}
	}
	if nm == 0 {
		return nil, fmt.Errorf("Open-Meteo Climate: sin modelos completos")
	}
	for k := 0; k < 12; k++ {
		md.TmaxAdd[k] = data.R2(md.TmaxAdd[k] / float64(nm))
		md.TminAdd[k] = data.R2(md.TminAdd[k] / float64(nm))
		m, s := 0.0, 0.0
		for _, x := range ratios[k] {
			m += x
		}
		m /= float64(len(ratios[k]))
		for _, x := range ratios[k] {
			s += (x - m) * (x - m)
		}
		md.PrRatio[k] = data.R2(m)
		md.PrSpread[k] = data.R2(math.Sqrt(s / float64(len(ratios[k]))))
	}
	m245 := md
	for k := 0; k < 12; k++ {
		m245.TmaxAdd[k] = data.R2(0.8 * md.TmaxAdd[k])
		m245.TminAdd[k] = data.R2(0.8 * md.TminAdd[k])
		m245.PrRatio[k] = data.R2(1 + 0.8*(md.PrRatio[k]-1))
	}
	return &data.CMIP6Point{Name: "Open-Meteo Climate", Lat: lat, Lon: lon, Scen: map[string]data.MonthlyDelta{"ssp585": md, "ssp245": m245}}, nil
}

func join(v []string) string {
	s := ""
	for i, x := range v {
		if i > 0 {
			s += ","
		}
		s += x
	}
	return s
}
