// maquina corre la máquina del tiempo 2026 y exporta los JSON del modo estático de la web.
//
//	go run ./internal/alerts/cmd/maquina -data data -out web/public/static/alertas
package main

import (
	"flag"
	"log"

	"fieldshift/internal/alerts"
	"fieldshift/internal/forecast"
)

func main() {
	dataDir := flag.String("data", "data", "carpeta data/ del motor")
	out := flag.String("out", "web/public/static/alertas", "salida")
	flag.Parse()
	e, err := alerts.NewEngine(nil, nil, nil, *dataDir)
	if err != nil {
		log.Fatal(err)
	}
	res, err := alerts.ExportStatic(e, forecast.LoadArchives(*dataDir), *out)
	if err != nil {
		log.Fatal(err)
	}
	for _, r := range res.Municipios {
		log.Printf("%s: %s", r.MunicipioID, r.Titular)
		for _, s := range r.Stats {
			log.Printf("   %-15s emitidas %2d aciertos %2d falsas %2d | eventos %2d detectados %2d antes %2d", s.Tipo, s.Emitidas, s.Aciertos, s.FalsasAlarmas, s.Eventos, s.Detectados, s.ConAnticipacion)
		}
	}
}
