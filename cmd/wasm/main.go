//go:build js && wasm

// wasm: el motor compilado a WebAssembly para correr el sandbox sin servidor.
//
//	GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o web/public/wasm/fieldshift.wasm ./cmd/wasm
//
// En el navegador: `simulate(siteJSON, reqJSON)` → JSON de contract.SimTimeline (o {"error": ...}).
// siteJSON = web/public/wasm/sites/<municipio>.json (lo escribe `go run ./cmd/export -wasm`).
package main

import (
	"encoding/json"
	"syscall/js"

	"fieldshift/internal/contract"
	"fieldshift/internal/plan"
)

var cache = map[string]plan.SimEnv{}

func simulate(this js.Value, args []js.Value) any {
	if len(args) < 2 {
		return `{"error":"simulate(siteJSON, reqJSON)"}`
	}
	siteJSON, reqJSON := args[0].String(), args[1].String()
	var b plan.SiteBundle
	key := ""
	if len(siteJSON) > 64 {
		key = siteJSON[:64] + string(rune(len(siteJSON)))
	}
	env, ok := cache[key]
	if !ok {
		if err := json.Unmarshal([]byte(siteJSON), &b); err != nil {
			return errJSON(err)
		}
		env = b.Env()
		cache[key] = env
	}
	var req contract.SimRequest
	if err := json.Unmarshal([]byte(reqJSON), &req); err != nil {
		return errJSON(err)
	}
	tl, err := plan.SimulateEnv(env, req)
	if err != nil {
		return errJSON(err)
	}
	out, _ := json.Marshal(tl)
	return string(out)
}

func errJSON(err error) string {
	b, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(b)
}

func main() {
	js.Global().Set("simulate", js.FuncOf(simulate))
	js.Global().Set("fieldshiftMotor", plan.Version)
	select {}
}
