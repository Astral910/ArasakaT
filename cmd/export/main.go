// export: escribe el fixture real del contrato y el modo estático (web/public/static/).
//
//	go run ./cmd/export -fixture -static
package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"
	"time"

	"fieldshift/internal/contract"
	"fieldshift/internal/plan"
)

var (
	dataDir   = flag.String("data", "data", "carpeta de datos")
	outDir    = flag.String("out", "web/public/static", "salida del modo estático")
	doFixture = flag.Bool("fixture", false, "reescribir contracts/fixtures/plan_jocotan.json")
	doStatic  = flag.Bool("static", false, "exportar JSON del modo estático")
	doSim     = flag.Bool("sim", false, "exportar líneas de tiempo del sandbox (fixture + static/sim)")
	doWasm    = flag.Bool("wasm", false, "exportar web/public/wasm/sites/<municipio>.json para el motor WebAssembly")
)

func main() {
	flag.Parse()
	e, err := plan.New(*dataDir)
	if err != nil {
		log.Fatal(err)
	}
	if *doFixture {
		t0 := time.Now()
		p, err := e.Plan(contract.PlanRequest{MunicipioID: "jocotan-chiquimula", Cultivo: "milpa", AreaValor: 8, AreaUnidad: "cuerda",
			ManoObra: "normal", SemillaCobertura: true, Prioridad: "comida", Horizonte: "2026", Idioma: "es"})
		if err != nil {
			log.Fatal(err)
		}
		write("contracts/fixtures/plan_jocotan.json", p, true)
		log.Printf("fixture listo (%s)", time.Since(t0).Round(time.Millisecond))
	}
	if *doSim {
		if err := exportSim(e, *outDir); err != nil {
			log.Fatal(err)
		}
	}
	if *doWasm {
		for _, h := range heroes {
			b, err := e.Bundle(h)
			if err != nil {
				log.Fatal(err)
			}
			write(filepath.Join("web", "public", "wasm", "sites", h+".json"), b, false)
		}
		log.Printf("wasm: sitios listos")
	}
	if *doStatic {
		if err := exportStatic(e, *outDir); err != nil {
			log.Fatal(err)
		}
	}
}

func write(path string, v any, indent bool) {
	os.MkdirAll(filepath.Dir(path), 0o755)
	f, err := os.Create(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	if indent {
		enc.SetIndent("", "  ")
	}
	if err := enc.Encode(v); err != nil {
		log.Fatal(err)
	}
}
