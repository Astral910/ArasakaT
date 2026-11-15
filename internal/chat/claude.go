package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ClaudeCLI: el asistente con Claude Code CLI (`claude -p`), la cuenta con la que está logueado el
// equipo (sin API key). Proceso oculto y en prioridad baja; solo herramientas del MCP fieldshift +
// WebSearch y WebFetch (sin archivos ni shell).
type ClaudeCLI struct {
	Bin      string // claude (o la ruta a un claude falso en tests)
	Modelo   string // sonnet | haiku | opus (CHAT_MODELO)
	MCPBin   string // cmd/fieldshift-mcp compilado
	API      string // base del servidor para el MCP (http://127.0.0.1:8224)
	Dir      string // carpeta de trabajo vacía (sin CLAUDE.md ni settings del repo)
	Esfuerzo string // low | medium | high (CHAT_ESFUERZO, opcional)
}

func (c *ClaudeCLI) Nombre() string { return "claude-code:" + c.Modelo }

// mcpConfig: JSON de --mcp-config con el token del turno (el MCP se lo pasa al servidor).
func (c *ClaudeCLI) mcpConfig(token string) string {
	cfg := map[string]any{"mcpServers": map[string]any{
		"fieldshift": map[string]any{
			"type": "stdio", "command": c.MCPBin, "args": []string{},
			"env": map[string]string{"FIELDSHIFT_API": c.API, "FIELDSHIFT_CHAT_TOKEN": token},
		},
	}}
	b, _ := json.Marshal(cfg)
	return string(b)
}

// Args: la línea de comando (exportada para los tests).
func (c *ClaudeCLI) Args(l Llamada) []string {
	a := []string{"-p", l.Mensaje,
		"--output-format", "json",
		"--system-prompt", l.Sistema,
		"--tools", "WebSearch,WebFetch", // únicas herramientas propias de Claude Code (sin Bash, Read, Edit…)
		"--allowedTools", "mcp__fieldshift", "WebSearch", "WebFetch",
		"--disallowedTools", "Bash", "PowerShell", "Edit", "Write", "Read", "Glob", "Grep", "NotebookEdit", "Agent", "Task",
		"--mcp-config", c.mcpConfig(l.Token),
		"--strict-mcp-config",
		"--setting-sources", "project",
		"--settings", `{"claudeMdExcludes":["**/CLAUDE.md","**/CLAUDE.local.md"]}`,
		"--max-turns", "8",
	}
	if c.Modelo != "" {
		a = append(a, "--model", c.Modelo)
	}
	if c.Esfuerzo != "" {
		a = append(a, "--effort", c.Esfuerzo)
	}
	if l.SesionID != "" {
		a = append(a, "--resume", l.SesionID)
	}
	return a
}

type salidaJSON struct {
	Type      string `json:"type"`
	Subtype   string `json:"subtype"`
	IsError   bool   `json:"is_error"`
	Result    string `json:"result"`
	SessionID string `json:"session_id"`
}

func (c *ClaudeCLI) Correr(ctx context.Context, l Llamada) (SalidaMotor, error) {
	bin := c.Bin
	if bin == "" {
		bin = "claude"
	}
	cmd := exec.CommandContext(ctx, bin, c.Args(l)...)
	cmd.Dir = c.Dir
	if c.Dir != "" {
		_ = os.MkdirAll(c.Dir, 0o755)
	}
	cmd.Env = append(os.Environ(),
		"CLAUDE_CODE_DISABLE_CLAUDE_MDS=1", // sin el CLAUDE.md del dueño ni del repo
		"CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
		"DISABLE_AUTOUPDATER=1",
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
	)
	cmd.Stdin = nil
	ocultar(cmd) // ventana oculta y prioridad baja (Windows)
	cmd.WaitDelay = 3 * time.Second
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	if ctx.Err() != nil {
		return SalidaMotor{}, fmt.Errorf("claude: tiempo límite: %w", ctx.Err())
	}
	s, perr := parsearSalida(out.Bytes())
	if perr != nil {
		if err != nil {
			return SalidaMotor{}, fmt.Errorf("claude: %v: %s", err, recorte(errb.String()+out.String()))
		}
		return SalidaMotor{}, perr
	}
	if s.IsError || (s.Subtype != "" && s.Subtype != "success") {
		return SalidaMotor{SesionID: s.SessionID}, fmt.Errorf("claude: %s %s", s.Subtype, recorte(s.Result))
	}
	return SalidaMotor{Texto: s.Result, SesionID: s.SessionID}, nil
}

// parsearSalida: --output-format json (un objeto) o, por si acaso, la última línea "result" de stream-json.
func parsearSalida(b []byte) (salidaJSON, error) {
	var s salidaJSON
	b = bytes.TrimSpace(b)
	if err := json.Unmarshal(b, &s); err == nil && (s.Result != "" || s.Type == "result") {
		return s, nil
	}
	lines := bytes.Split(b, []byte("\n"))
	for i := len(lines) - 1; i >= 0; i-- {
		var x salidaJSON
		if json.Unmarshal(bytes.TrimSpace(lines[i]), &x) == nil && x.Type == "result" {
			return x, nil
		}
	}
	return s, errors.New("claude: salida sin resultado: " + recorte(string(b)))
}

func recorte(s string) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > 300 {
		return string(r[:300]) + "…"
	}
	return s
}

// BuscarMCP: el binario del puente MCP (CHAT_MCP_BIN, junto al servidor, o bin/ del repo).
func BuscarMCP(raiz string) string {
	if p := os.Getenv("CHAT_MCP_BIN"); p != "" {
		return p
	}
	nombre := "fieldshift-mcp"
	if exe := strings.ToLower(filepath.Ext(os.Args[0])); exe == ".exe" || os.PathSeparator == '\\' {
		nombre += ".exe"
	}
	cands := []string{}
	if e, err := os.Executable(); err == nil {
		cands = append(cands, filepath.Join(filepath.Dir(e), nombre))
	}
	cands = append(cands, filepath.Join(raiz, "bin", nombre))
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// ConfigDesdeEnv: CHAT_MOTOR (claude|off), CHAT_MODELO, CHAT_TIMEOUT_S, CHAT_MAX, CHAT_CLAUDE_BIN, CHAT_ESFUERZO.
func ConfigDesdeEnv() (Config, string, string, string, string) {
	cfg := Config{MaxParalelo: 2, Timeout: 90 * time.Second}
	if n, err := strconv.Atoi(os.Getenv("CHAT_MAX")); err == nil && n > 0 {
		cfg.MaxParalelo = n
	}
	if n, err := strconv.Atoi(os.Getenv("CHAT_TIMEOUT_S")); err == nil && n > 0 {
		cfg.Timeout = time.Duration(n) * time.Second
	}
	modelo := os.Getenv("CHAT_MODELO")
	if modelo == "" {
		modelo = "sonnet"
	}
	bin := os.Getenv("CHAT_CLAUDE_BIN")
	if bin == "" {
		bin = "claude"
	}
	return cfg, strings.ToLower(os.Getenv("CHAT_MOTOR")), modelo, bin, os.Getenv("CHAT_ESFUERZO")
}

// ResolverClaude: en Windows npm instala claude.cmd; por un .cmd los argumentos pasan por cmd.exe y el
// prompt (comillas, saltos de línea, |) se rompe. Si al lado está el claude.exe del paquete, se usa ese.
func ResolverClaude(ruta string) string {
	if !strings.EqualFold(filepath.Ext(ruta), ".cmd") && !strings.EqualFold(filepath.Ext(ruta), ".bat") {
		return ruta
	}
	exe := filepath.Join(filepath.Dir(ruta), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
	if st, err := os.Stat(exe); err == nil && !st.IsDir() {
		return exe
	}
	return ruta
}
