// precalc renderiza los videos de respaldo (Jocotán y Camotán · S0/S2 · típico y El Niño)
// a web/public/static/video/<municipio>_<S>_<escenario>_<riego>.mp4. Necesita la web corriendo
// (vite o el servidor Go) con /sandbox?rec=1, Chrome y ffmpeg.
//
//	go run ./internal/simvideo/precalc -base http://127.0.0.1:8204 -ruta /sandbox
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"fieldshift/internal/simvideo"
)

func main() {
	base := flag.String("base", "http://127.0.0.1:8204", "dónde corre la web")
	ruta := flag.String("ruta", "/sandbox", "ruta del modo grabación")
	out := flag.String("out", filepath.Join("web", "public", "static", "video"), "carpeta de salida")
	muns := flag.String("municipios", "jocotan-chiquimula,camotan-chiquimula", "")
	ests := flag.String("estrategias", "S0,S2", "")
	escs := flag.String("escenarios", "tipico,nino", "")
	riegos := flag.String("riego", "0", "mm/semana separados por coma")
	idiomas := flag.String("idiomas", "es", "")
	bitrate := flag.Int("bitrate", 2_000_000, "bps (precalculados livianos para el repo)")
	forzar := flag.Bool("forzar", false, "re-renderizar aunque exista")
	urlPub := flag.String("url", os.Getenv("WEB_URL"), "link de la tarjeta final (vacío = sin link)")
	flag.Parse()

	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}
	r := &simvideo.ChromeFFmpeg{Chrome: os.Getenv("CHROME_PATH"), FFmpeg: os.Getenv("FFMPEG_PATH"), Encoder: os.Getenv("SIMVIDEO_ENCODER"), Bitrate: *bitrate}
	if err := r.Disponible(); err != nil {
		log.Fatal(err)
	}
	s := simvideo.Nuevo(simvideo.Config{BaseURL: *base, Ruta: *ruta, URLPublica: *urlPub})
	fallos := 0
	for _, m := range strings.Split(*muns, ",") {
		for _, e := range strings.Split(*ests, ",") {
			for _, esc := range strings.Split(*escs, ",") {
				for _, rg := range strings.Split(*riegos, ",") {
					for _, L := range strings.Split(*idiomas, ",") {
						var mm float64
						fmt.Sscan(rg, &mm)
						c := simvideo.Consulta{MunicipioID: m, Estrategia: e, Escenario: esc, RiegoMM: mm, Idioma: L}.Normalizar()
						dst := filepath.Join(*out, c.NombrePrecalc())
						if _, err := os.Stat(dst); err == nil && !*forzar {
							log.Printf("ya existe %s", dst)
							continue
						}
						t0 := time.Now()
						ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
						err := r.Render(ctx, s.URLGrabacion(c), dst)
						cancel()
						if err != nil {
							fallos++
							log.Printf("FALLÓ %s: %v", c.NombrePrecalc(), err)
							continue
						}
						st, _ := os.Stat(dst)
						info, _ := exec.Command("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "csv=p=0", dst).Output()
						log.Printf("%s · %.1f MB · %s · %s", c.NombrePrecalc(), float64(st.Size())/1e6, strings.ReplaceAll(strings.TrimSpace(string(info)), "\n", " "), time.Since(t0).Round(time.Second))
					}
				}
			}
		}
	}
	if fallos > 0 {
		os.Exit(1)
	}
}
