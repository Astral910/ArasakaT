// servidor de prueba de las alertas (el servidor real lo arma el integrador en cmd/server).
// Mensajero falso: imprime los envíos con el teléfono enmascarado.
//
//	ADMIN_TOKEN=xxx go run ./internal/alerts/cmd/servidor -addr 127.0.0.1:8203
package main

import (
	"flag"
	"log"
	"net/http"
	"strings"

	"fieldshift/internal/alerts"
	"fieldshift/internal/contract"
	"fieldshift/internal/store"
)

type logMsg struct{}

func (logMsg) EnviarTexto(tel, texto string) error {
	log.Printf("[texto → %s] %s", store.Mask(tel), strings.ReplaceAll(texto, "\n", " ⏎ "))
	return nil
}
func (logMsg) EnviarBotones(tel, texto string, b []contract.Boton) error {
	log.Printf("[botones → %s] %d botones", store.Mask(tel), len(b))
	return nil
}
func (logMsg) EnviarImagen(tel string, png []byte, caption string) error { return nil }
func (logMsg) EnviarPlantilla(tel, plantilla, idioma string, vars []string) error {
	log.Printf("[plantilla %s/%s → %s] %s", plantilla, idioma, store.Mask(tel), strings.Join(vars, " | "))
	return nil
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8203", "dirección")
	dataDir := flag.String("data", "data", "data/ del motor")
	db := flag.String("db", "var/alertas-dev.db", "SQLite")
	sched := flag.Bool("scheduler", false, "correr el scheduler de las 06:00")
	flag.Parse()
	svc, err := alerts.New(alerts.Config{DataDir: *dataDir, DBPath: *db, CacheDir: "var/cache/forecast", Mensajero: logMsg{}})
	if err != nil {
		log.Fatal(err)
	}
	if *sched {
		defer svc.StartScheduler()()
	}
	mux := http.NewServeMux()
	alerts.Routes(mux, svc)
	log.Printf("alertas escuchando en http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
