// Simulador de la estación de campo: manda al servidor lecturas falsas pero realistas (balance de agua
// de dos capas, golpes del pluviómetro con hora, batería con el sol) igual que el firmware.
//
//	go run ./hardware/simulador -url http://127.0.0.1:8225 -parcela demo -escenario lluvia
//
// Sin -id/-token da de alta un dispositivo nuevo (POST /api/sensores; con cuentas hace falta la cookie:
// -cookie "fs_sesion=…" -csrf …). Escenarios: lluvia (18 mm hoy que no estaban pronosticados) y secado
// (6 días sin lluvia, el suelo baja del umbral → "regá Z mm"). Manda de a 96 lecturas como el búfer real.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"fieldshift/internal/sensores"
)

func main() {
	base := flag.String("url", "http://127.0.0.1:8225", "servidor")
	parcela := flag.String("parcela", "demo", "ID de la parcela")
	id := flag.String("id", "", "ID del dispositivo (vacío = alta nueva)")
	token := flag.String("token", "", "token del dispositivo")
	esc := flag.String("escenario", sensores.EscLluvia, "lluvia | secado")
	dias := flag.Int("dias", 7, "días de historia")
	cookie := flag.String("cookie", "", "cookie de sesión para el alta (con cuentas)")
	csrf := flag.String("csrf", "", "X-CSRF-Token para el alta (con cuentas)")
	malo := flag.Bool("token-malo", false, "manda con un token inválido (tiene que dar 401)")
	flag.Parse()

	if *id == "" {
		b, _ := json.Marshal(map[string]string{"parcela_id": *parcela, "nombre": "Estación simulada (" + *esc + ")"})
		q, _ := http.NewRequest("POST", *base+"/api/sensores", bytes.NewReader(b))
		q.Header.Set("Content-Type", "application/json")
		if *cookie != "" {
			q.Header.Set("Cookie", *cookie)
		}
		if *csrf != "" {
			q.Header.Set("X-CSRF-Token", *csrf)
		}
		r, err := http.DefaultClient.Do(q)
		if err != nil {
			log.Fatal(err)
		}
		var a struct {
			Dispositivo struct{ ID string } `json:"dispositivo"`
			Token       string              `json:"token"`
		}
		body, _ := io.ReadAll(r.Body)
		r.Body.Close()
		if r.StatusCode != 201 || json.Unmarshal(body, &a) != nil {
			log.Fatalf("alta: HTTP %d %s", r.StatusCode, body)
		}
		*id, *token = a.Dispositivo.ID, a.Token
		fmt.Printf("alta: dispositivo %s token %s\n", *id, *token)
	}
	if *malo {
		*token = "fsd_malo"
	}
	sim := sensores.Simular(time.Now(), *dias, *esc, -6*3600, sensores.TexturaFranca, time.Now().UnixNano())
	ls := sim.Paquete.Lecturas
	var ultimo map[string]any
	for i := 0; i < len(ls); i += 96 {
		j := min(i+96, len(ls))
		p := sim.Paquete
		p.Lecturas = ls[i:j]
		p.Golpes = nil
		if j == len(ls) {
			p.Golpes = sim.Paquete.Golpes
		}
		p.Ahora = time.Now().Unix()
		b, _ := json.Marshal(p)
		q, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/sensores/%s/lecturas", *base, *id), bytes.NewReader(b))
		q.Header.Set("Content-Type", "application/json")
		q.Header.Set("Authorization", "Bearer "+*token)
		r, err := http.DefaultClient.Do(q)
		if err != nil {
			log.Fatal(err)
		}
		body, _ := io.ReadAll(r.Body)
		r.Body.Close()
		if r.StatusCode != 202 {
			fmt.Printf("HTTP %d %s\n", r.StatusCode, body)
			os.Exit(1)
		}
		_ = json.Unmarshal(body, &ultimo)
	}
	fmt.Printf("enviadas %d lecturas y %d golpes\n", len(ls), len(sim.Paquete.Golpes))
	if e, ok := ultimo["estado"].(map[string]any); ok {
		fmt.Printf("agua %v %% (10 cm %v, 30 cm %v) · lluvia hoy %v mm\n", e["agua_pct"], e["h10"].(map[string]any)["agua_pct"], e["h30"].(map[string]any)["agua_pct"], e["lluvia_hoy_mm"])
		if evs, ok := e["eventos"].([]any); ok {
			for _, ev := range evs {
				m := ev.(map[string]any)
				ac, _ := m["accion"].(string)
				fmt.Printf("  [%s] %s %s\n", m["tipo"], m["texto"], ac)
			}
		}
	}
}
