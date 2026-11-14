package main

import (
	"context"
	"log"
	"time"
	_ "time/tzdata" // zona de Guatemala también en Windows y en contenedores mínimos
)

var zonaGT = func() *time.Location {
	if l, err := time.LoadLocation("America/Guatemala"); err == nil {
		return l
	}
	return time.FixedZone("CST", -6*3600)
}()

// proximaCorrida devuelve el siguiente HH:MM (hora de Guatemala) después de now.
func proximaCorrida(now time.Time, hora string) time.Time {
	t, err := time.Parse("15:04", hora)
	if err != nil {
		t, _ = time.Parse("15:04", "06:00")
	}
	n := now.In(zonaGT)
	next := time.Date(n.Year(), n.Month(), n.Day(), t.Hour(), t.Minute(), 0, 0, zonaGT)
	if !next.After(n) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

// scheduler revisa el pronóstico de cada suscriptor cada `cada` (3 h por defecto), empezando un minuto después
// de arrancar. Sin duplicados y en horario decente (7:00–20:00 local): lo garantiza internal/alerts.
func scheduler(ctx context.Context, cada time.Duration, al Alertador) {
	espera := time.Minute
	for {
		log.Printf("scheduler: próxima revisión de alertas en %s (cada %s)", espera, cada)
		select {
		case <-ctx.Done():
			return
		case <-time.After(espera):
			if err := al.Correr(time.Now()); err != nil {
				log.Printf("scheduler: corrida: %v", err)
			}
		}
		espera = cada
	}
}
