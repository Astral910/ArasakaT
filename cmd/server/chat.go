package main

// CHAT (internal/chat, agente chatbot): asistente en el dashboard, el simulador y WhatsApp.
// Cerebro: Claude Code CLI (`claude -p`, cuenta del equipo) + MCP fieldshift (cmd/fieldshift-mcp).
// Sin claude o sin el MCP, responde el respaldo por reglas. En producción: API de Anthropic (docs/chat.md).

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"fieldshift/internal/bot"
	"fieldshift/internal/chat"
	"fieldshift/internal/contract"
)

func montarChat(mux *http.ServeMux, cfg Config, planner contract.Planner, sim chat.Simulador) (*chat.Servicio, string) {
	ccfg, modo, modelo, bin, esfuerzo := chat.ConfigDesdeEnv()
	dir := filepath.Join(filepath.Dir(cfg.DBPath), "chat")
	ccfg.Dir = dir
	secreto := os.Getenv("CHAT_SECRETO")
	if secreto == "" {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		secreto = hex.EncodeToString(b)
	}
	h := &chat.Herramientas{Planner: planner, Simulador: sim, Campo: chat.CampoHTTP{H: mux, Secreto: secreto}}
	var motor chat.Motor
	estado := "respaldo"
	if modo != "off" {
		claude, err := exec.LookPath(bin)
		claude = chat.ResolverClaude(claude)
		mcp := chat.BuscarMCP(bot.RepoRoot())
		if mcp == "" && err == nil {
			mcp = compilarMCP(dir)
		}
		switch {
		case err != nil:
			log.Printf("chat: no encuentro %q (%v) → respaldo por reglas", bin, err)
		case mcp == "":
			log.Printf("chat: falta fieldshift-mcp (go build -o bin/fieldshift-mcp ./cmd/fieldshift-mcp) → respaldo")
		default:
			motor = &chat.ClaudeCLI{Bin: claude, Modelo: modelo, MCPBin: mcp, API: baseLocal(cfg.Addr), Dir: filepath.Join(dir, "cwd"), Esfuerzo: esfuerzo}
			estado = "claude:" + modelo
			log.Printf("chat: claude %s (%s) · MCP %s · máx %d a la vez · %s", modelo, claude, mcp, ccfg.MaxParalelo, ccfg.Timeout)
		}
	}
	s := chat.Nuevo(ccfg, motor, h)
	chat.Routes(mux, s)
	return s, estado
}

// compilarMCP: en desarrollo, si hay Go y el código, compila el puente MCP junto a la base de datos.
func compilarMCP(dir string) string {
	if _, err := exec.LookPath("go"); err != nil {
		return ""
	}
	root := bot.RepoRoot()
	if _, err := os.Stat(filepath.Join(root, "cmd", "fieldshift-mcp", "main.go")); err != nil {
		return ""
	}
	out := filepath.Join(dir, "fieldshift-mcp")
	if runtime.GOOS == "windows" {
		out += ".exe"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "go", "build", "-o", out, "./cmd/fieldshift-mcp")
	cmd.Dir = root
	if b, err := cmd.CombinedOutput(); err != nil {
		log.Printf("chat: compilar MCP: %v %s", err, b)
		return ""
	}
	return out
}
