// fieldshift-mcp: servidor MCP (stdio, JSON-RPC 2.0 por líneas) con las herramientas del asistente.
// Lo arranca `claude -p` (--mcp-config); cada llamada va a POST {FIELDSHIFT_API}/api/chat/herramienta
// con FIELDSHIFT_CHAT_TOKEN, y el servidor la ejecuta en el turno de esa pregunta. Sin archivos ni shell.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"fieldshift/internal/chat"
)

type mensaje struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type respuesta struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

var cliente = &http.Client{Timeout: 60 * time.Second}

func main() {
	api := strings.TrimRight(os.Getenv("FIELDSHIFT_API"), "/")
	if api == "" {
		api = "http://127.0.0.1:8080"
	}
	token := os.Getenv("FIELDSHIFT_CHAT_TOKEN")
	servir(os.Stdin, os.Stdout, func(nombre string, args map[string]any) (string, bool) {
		return llamar(api, token, nombre, args)
	})
}

// servir atiende el protocolo; ejecutar devuelve (texto, esError).
func servir(in io.Reader, out io.Writer, ejecutar func(string, map[string]any) (string, bool)) {
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 8<<20)
	enc := json.NewEncoder(out)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var m mensaje
		if err := json.Unmarshal(line, &m); err != nil {
			_ = enc.Encode(respuesta{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32700, "parse error"}})
			continue
		}
		if len(m.ID) == 0 { // notificación (notifications/initialized, cancelled…): sin respuesta
			continue
		}
		r := respuesta{JSONRPC: "2.0", ID: m.ID}
		switch m.Method {
		case "initialize":
			var p struct {
				ProtocolVersion string `json:"protocolVersion"`
			}
			_ = json.Unmarshal(m.Params, &p)
			if p.ProtocolVersion == "" {
				p.ProtocolVersion = "2025-06-18"
			}
			r.Result = map[string]any{
				"protocolVersion": p.ProtocolVersion,
				"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
				"serverInfo":      map[string]any{"name": "fieldshift", "version": "1.0.0"},
				"instructions":    "Herramientas de SeedView: plan, simulación, riego de hoy, reportes del agricultor, plagas y acciones de pantalla.",
			}
		case "ping":
			r.Result = map[string]any{}
		case "tools/list":
			r.Result = map[string]any{"tools": chat.Definiciones()}
		case "tools/call":
			var p struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			if err := json.Unmarshal(m.Params, &p); err != nil {
				r.Error = &rpcError{-32602, "params inválidos"}
				break
			}
			texto, esError := ejecutar(p.Name, p.Arguments)
			r.Result = map[string]any{"content": []map[string]any{{"type": "text", "text": texto}}, "isError": esError}
		default:
			r.Error = &rpcError{-32601, "método no encontrado: " + m.Method}
		}
		_ = enc.Encode(r)
	}
}

func llamar(api, token, nombre string, args map[string]any) (string, bool) {
	b, _ := json.Marshal(chat.LlamadaHerramienta{Token: token, Nombre: nombre, Args: args})
	res, err := cliente.Post(api+"/api/chat/herramienta", "application/json", bytes.NewReader(b))
	if err != nil {
		return "servidor SeedView no responde: " + err.Error(), true
	}
	defer res.Body.Close()
	var v struct {
		Resultado json.RawMessage `json:"resultado"`
		Error     string          `json:"error"`
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err := json.Unmarshal(body, &v); err != nil {
		return fmt.Sprintf("respuesta inválida (%d)", res.StatusCode), true
	}
	if v.Error != "" {
		return v.Error, true
	}
	return string(v.Resultado), false
}
