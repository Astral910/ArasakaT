// Demo del bot solo (sin el resto del servidor): go run ./internal/channels/demo -addr 127.0.0.1:8202
// Monta /api/chat, /webhook/whatsapp, /webhook/twilio y /api/cards/plan.png con el fixture.
// El servidor completo lo arma el integrador en cmd/server con channels.Routes.
package main

import (
	"flag"
	"log"
	"net/http"

	"fieldshift/internal/channels"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8202", "dirección")
	flag.Parse()
	mux := http.NewServeMux()
	channels.Routes(mux, channels.DepsDesdeEnv())
	log.Printf("bot demo en http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
