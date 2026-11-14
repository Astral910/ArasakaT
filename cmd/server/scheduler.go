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

// scheduler corre el motor de alertas una vez al día. La idempotencia la garantiza internal/alerts.
func scheduler(ctx context.Context, hora string, al Alertador) {
	for {
		next := proximaCorrida(time.Now(), hora)
		log.Printf("scheduler: próxima corrida de alertas %s", next.Format(time.RFC3339))
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(next)):
			fecha := next.Format("2006-01-02")
			if err := al.RunDaily(fecha); err != nil {
				log.Printf("scheduler: corrida %s: %v", fecha, err)
			}
		}
	}
}
