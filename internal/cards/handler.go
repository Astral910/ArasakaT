package cards

import (
	"log"
	"net/http"
	"sync"

	"fieldshift/internal/bot"
	"fieldshift/internal/contract"
)

// Handler sirve GET /api/cards/plan.png?municipio=&cultivo=&riego=&ganado=&prioridad=&horizonte=&idioma=
// Calcula el plan con el Planner y dibuja la tarjeta (con caché en memoria).
func Handler(planner contract.Planner) http.Handler {
	var mu sync.Mutex
	cache := map[string][]byte{}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		req := bot.ReqDesdeQuery(r.URL.Query())
		key := bot.QueryPlan(req).Encode()
		mu.Lock()
		png, ok := cache[key]
		mu.Unlock()
		if !ok {
			if planner == nil {
				http.Error(w, "sin planner", http.StatusServiceUnavailable)
				return
			}
			p, err := planner.Plan(req)
			if err != nil {
				log.Printf("cards: plan %s: %v", req.MunicipioID, err)
				http.Error(w, "no se pudo calcular el plan", http.StatusBadGateway)
				return
			}
			png, err = Render(&p, req.Idioma)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			mu.Lock()
			if len(cache) > 256 {
				cache = map[string][]byte{}
			}
			cache[key] = png
			mu.Unlock()
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_, _ = w.Write(png)
	})
}
