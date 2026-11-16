// claude-falso: hace de `claude -p` en los e2e (CHAT_CLAUDE_BIN). Igual que el de internal/chat/chat_test.go:
// arranca el MCP real (cmd/fieldshift-mcp) por stdio, llama la herramienta que corresponde y devuelve el JSON de -p.
// "del 1 de julio al 1 de agosto" → abrir_simulacion(desde, hasta); "llovió" → registrar_reporte; "riego" → riego_hoy.
//
//	go build -o e2e/.bin/claude-falso.exe ./e2e/claude-falso
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var meses = map[string]int{"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
	"septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
	"january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12}

var reFecha = regexp.MustCompile(`(?i)(\d{1,2})\s+de\s+([a-záéíóú]+)`)

// rango "del 1 de julio al 1 de agosto" → AAAA-07-01, AAAA-08-01 (el próximo julio si ya pasó)
func rango(msg string) (string, string, bool) {
	m := reFecha.FindAllStringSubmatch(msg, 2)
	if len(m) < 2 {
		return "", "", false
	}
	f := func(x []string) string {
		var d int
		fmt.Sscan(x[1], &d)
		hoy := time.Now()
		t := time.Date(hoy.Year(), time.Month(meses[strings.ToLower(x[2])]), d, 0, 0, 0, 0, time.Local)
		if t.Before(hoy.AddDate(0, 0, -1)) { // ya pasó: la próxima temporada
			t = t.AddDate(1, 0, 0)
		}
		return t.Format("2006-01-02")
	}
	return f(m[0]), f(m[1]), meses[strings.ToLower(m[0][2])] > 0 && meses[strings.ToLower(m[1][2])] > 0
}

func main() {
	args := os.Args[1:]
	var msg, mcp, resume string
	for i := 0; i < len(args)-1; i++ {
		switch args[i] {
		case "-p":
			msg = args[i+1]
		case "--mcp-config":
			mcp = args[i+1]
		case "--resume":
			resume = args[i+1]
		}
	}
	var cfg struct {
		MCPServers map[string]struct {
			Command string            `json:"command"`
			Args    []string          `json:"args"`
			Env     map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if strings.HasPrefix(strings.TrimSpace(mcp), "{") {
		_ = json.Unmarshal([]byte(mcp), &cfg)
	} else if b, err := os.ReadFile(mcp); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
	srv, ok := cfg.MCPServers["fieldshift"]
	if !ok {
		fmt.Fprintln(os.Stderr, "sin mcp fieldshift")
		os.Exit(2)
	}
	cmd := exec.Command(srv.Command, srv.Args...)
	cmd.Env = os.Environ()
	for k, v := range srv.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	in, _ := cmd.StdinPipe()
	outp, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "mcp:", err)
		os.Exit(3)
	}
	defer cmd.Process.Kill()
	rd := bufio.NewReader(outp)
	id := 0
	rpc := func(method string, params any) map[string]any {
		id++
		b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
		in.Write(append(b, '\n'))
		line, _ := rd.ReadBytes('\n')
		var r map[string]any
		_ = json.Unmarshal(line, &r)
		return r
	}
	rpc("initialize", map[string]any{"protocolVersion": "2025-06-18"})
	in.Write([]byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}` + "\n"))
	llamar := func(n string, a map[string]any) string {
		r := rpc("tools/call", map[string]any{"name": n, "arguments": a})
		res, _ := r["result"].(map[string]any)
		cs, _ := res["content"].([]any)
		if len(cs) == 0 {
			return fmt.Sprint(r["error"])
		}
		c, _ := cs[0].(map[string]any)
		return fmt.Sprint(c["text"])
	}
	// el mensaje del usuario va después del "[contexto …]" que arma internal/chat
	if i := strings.Index(msg, "]\n"); i >= 0 {
		msg = msg[i+2:]
	}
	low := strings.ToLower(msg)
	texto := "Soy el asistente de prueba (claude falso de los e2e)."
	if d, h, ok := rango(msg); ok {
		llamar("abrir_simulacion", map[string]any{"desde": d, "hasta": h})
		texto = "Te abrí la simulación del " + d + " al " + h + " en tu terreno."
	} else if strings.Contains(low, "llovi") {
		llamar("registrar_reporte", map[string]any{"tipo": "lluvia", "valor": 40, "unidad": "mm", "texto": "llovió mucho"})
		texto = "Anoté la lluvia: hoy regá menos."
	} else if strings.Contains(low, "riego") || strings.Contains(low, "regar") {
		texto = "Riego de hoy: " + llamar("riego_hoy", nil)
	}
	sid := resume
	if sid == "" {
		sid = "ses-e2e"
	}
	out, _ := json.Marshal(map[string]any{"type": "result", "subtype": "success", "is_error": false, "session_id": sid,
		"result": texto + "\nFuentes: FAO-56 https://www.fao.org/3/x0490s/x0490s00.htm | Motor SeedView"})
	os.Stdout.Write(out)
}
