package bot

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// GeoWeb: geocodificador sin llaves. Nombre → lugares: Open-Meteo Geocoding (GeoNames). Coordenada → nombre:
// Nominatim (OpenStreetMap; 1 consulta por segundo, User-Agent propio). Respuestas en memoria.
type GeoWeb struct {
	HTTP        *http.Client
	BaseBuscar  string // https://geocoding-api.open-meteo.com/v1/search
	BaseReverso string // https://nominatim.openstreetmap.org/reverse
	UserAgent   string

	mu    sync.Mutex
	cache map[string]any
	ult   time.Time
}

// NewGeoWeb con valores por defecto.
func NewGeoWeb() *GeoWeb {
	return &GeoWeb{HTTP: &http.Client{Timeout: 8 * time.Second},
		BaseBuscar:  "https://geocoding-api.open-meteo.com/v1/search",
		BaseReverso: "https://nominatim.openstreetmap.org/reverse",
		UserAgent:   "FieldShift/1.0 (NASA Space Apps 2026; bot de WhatsApp)"}
}

func (g *GeoWeb) getJSON(u string, out any) error {
	g.mu.Lock()
	if g.cache == nil {
		g.cache = map[string]any{}
	}
	if v, ok := g.cache[u]; ok {
		g.mu.Unlock()
		b, _ := json.Marshal(v)
		return json.Unmarshal(b, out)
	}
	if d := time.Since(g.ult); d < time.Second { // política de uso de Nominatim
		time.Sleep(time.Second - d)
	}
	g.ult = time.Now()
	g.mu.Unlock()
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("User-Agent", g.UserAgent)
	res, err := g.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("geocodificador: %s", res.Status)
	}
	var raw any
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return err
	}
	g.mu.Lock()
	if len(g.cache) > 5000 {
		g.cache = map[string]any{}
	}
	g.cache[u] = raw
	g.mu.Unlock()
	b, _ := json.Marshal(raw)
	return json.Unmarshal(b, out)
}

// Buscar lugares por nombre (hasta 6), en el idioma de la persona.
func (g *GeoWeb) Buscar(q, idioma string) ([]Lugar, error) {
	q = strings.TrimSpace(q)
	if len([]rune(q)) < 3 {
		return nil, nil
	}
	v := url.Values{"name": {q}, "count": {"6"}, "language": {idiomaGeo(idioma)}, "format": {"json"}}
	var r struct {
		Results []struct {
			Name        string  `json:"name"`
			Admin1      string  `json:"admin1"`
			CountryCode string  `json:"country_code"`
			Latitude    float64 `json:"latitude"`
			Longitude   float64 `json:"longitude"`
		} `json:"results"`
	}
	if err := g.getJSON(g.BaseBuscar+"?"+v.Encode(), &r); err != nil {
		return nil, err
	}
	var out []Lugar
	for _, x := range r.Results {
		out = append(out, Lugar{Nombre: x.Name, Region: x.Admin1, Pais: strings.ToUpper(x.CountryCode), Lat: x.Latitude, Lon: x.Longitude})
	}
	return out, nil
}

// Nombre de una coordenada (ciudad o municipio, región, país).
func (g *GeoWeb) Nombre(lat, lon float64, idioma string) (Lugar, error) {
	v := url.Values{"format": {"jsonv2"}, "lat": {fmt.Sprintf("%.4f", lat)}, "lon": {fmt.Sprintf("%.4f", lon)}, "zoom": {"10"}, "accept-language": {idiomaGeo(idioma)}}
	var r struct {
		Address map[string]string `json:"address"`
	}
	if err := g.getJSON(g.BaseReverso+"?"+v.Encode(), &r); err != nil {
		return Lugar{}, err
	}
	a := r.Address
	l := Lugar{Lat: lat, Lon: lon, Pais: strings.ToUpper(a["country_code"])}
	for _, k := range []string{"city", "town", "village", "municipality", "county", "state_district"} {
		if a[k] != "" {
			l.Nombre = a[k]
			break
		}
	}
	l.Region = a["state"]
	if l.Nombre == "" {
		l.Nombre, l.Region = l.Region, ""
	}
	if l.Nombre == "" {
		return l, fmt.Errorf("geocodificador: sin nombre para %.2f,%.2f", lat, lon)
	}
	return l, nil
}

func idiomaGeo(L string) string {
	if L == "en" {
		return "en"
	}
	return "es"
}
