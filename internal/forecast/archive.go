// Package forecast: pronóstico de 16 días (Open-Meteo, multi-modelo/ensamble) y archivo histórico 2026.
package forecast

// Run: una corrida de un modelo, días locales desde la fecha de inicio.
type Run struct {
	PR   []float64 `json:"pr"`
	Tmin []float64 `json:"tmin"`
	Tmax []float64 `json:"tmax"`
}

// Archive: corridas archivadas por modelo y fecha de inicio (YYYY-MM-DD).
type Archive struct {
	Site   string                    `json:"site"`
	Lat    float64                   `json:"lat"`
	Lon    float64                   `json:"lon"`
	Source string                    `json:"source"`
	Runs   map[string]map[string]Run `json:"runs"`
}

// Members devuelve las corridas disponibles para una fecha de inicio (el "ensamble" multi-modelo).
func (a *Archive) Members(date string) []Run {
	var out []Run
	for _, m := range sortedKeys(a.Runs) {
		if r, ok := a.Runs[m][date]; ok {
			out = append(out, r)
		}
	}
	return out
}
