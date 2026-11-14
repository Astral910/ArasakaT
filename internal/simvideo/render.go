package simvideo

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/chromedp"
)

// MaxBytes: límite de WhatsApp para video.
const MaxBytes = 16 << 20

// Renderizador produce un MP4 en dst a partir de la URL del modo grabación.
type Renderizador interface {
	Render(ctx context.Context, pagina string, dst string) error
}

// ChromeFFmpeg: Chromium headless (chromedp) + ffmpeg por tubería (cuadros JPEG → H.264).
type ChromeFFmpeg struct {
	Chrome  string        // ruta a Chrome/Chromium; vacío = el que encuentre chromedp
	FFmpeg  string        // ruta a ffmpeg; vacío = "ffmpeg" del PATH
	Encoder string        // h264_nvenc | libx264 | "" (auto: NVENC si funciona)
	Espera  time.Duration // cuánto esperar a que la página esté lista (por defecto 90 s)
	Bitrate int           // bps; 0 = según calidad (3 Mbps 720p, 6 Mbps 1080p)

	once    sync.Once
	encoder string
}

// Info que publica la página en window.__fsRec.
type infoRec struct {
	Listo   bool    `json:"listo"`
	Error   string  `json:"error"`
	Ancho   int     `json:"ancho"`
	Alto    int     `json:"alto"`
	Fps     int     `json:"fps"`
	Cuadros int     `json:"cuadros"`
	Dur     float64 `json:"duracion"`
}

func (r *ChromeFFmpeg) ffmpeg() string {
	if r.FFmpeg != "" {
		return r.FFmpeg
	}
	return "ffmpeg"
}

// EncoderElegido prueba NVENC una vez (1 cuadro) y si falla usa libx264.
func (r *ChromeFFmpeg) EncoderElegido() string {
	r.once.Do(func() {
		if r.Encoder != "" {
			r.encoder = r.Encoder
			return
		}
		r.encoder = "libx264"
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, r.ffmpeg(), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2",
			"-c:v", "h264_nvenc", "-f", "null", "-")
		if err := cmd.Run(); err == nil {
			r.encoder = "h264_nvenc"
		}
		log.Printf("simvideo: codificador %s", r.encoder)
	})
	return r.encoder
}

// Disponible: hay ffmpeg y algún Chrome.
func (r *ChromeFFmpeg) Disponible() error {
	if _, err := exec.LookPath(r.ffmpeg()); err != nil {
		return fmt.Errorf("sin ffmpeg: %w", err)
	}
	if r.Chrome != "" {
		if _, err := os.Stat(r.Chrome); err != nil {
			return fmt.Errorf("sin chrome en %s", r.Chrome)
		}
		return nil
	}
	for _, c := range candidatosChrome() {
		if p, err := exec.LookPath(c); err == nil && p != "" {
			return nil
		}
	}
	return errors.New("sin chrome/chromium (CHROME_PATH)")
}

func candidatosChrome() []string {
	if runtime.GOOS == "windows" {
		return []string{
			`C:\Program Files\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
			"chrome.exe",
		}
	}
	return []string{"chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "headless-shell", "/usr/bin/chromium"}
}

func (r *ChromeFFmpeg) Render(ctx context.Context, pagina, dst string) error {
	opts := append([]chromedp.ExecAllocatorOption{}, chromedp.DefaultExecAllocatorOptions[:]...)
	opts = append(opts,
		chromedp.Flag("mute-audio", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("ignore-gpu-blocklist", true),
		chromedp.WindowSize(1280, 720),
	)
	if runtime.GOOS == "windows" {
		// headless con la GPU (si no, WebGL dibuja con la CPU)
		opts = append(opts, chromedp.Flag("enable-gpu", true), chromedp.Flag("use-angle", "d3d11"))
	} else {
		opts = append(opts, chromedp.Flag("use-gl", "angle"), chromedp.Flag("use-angle", "swiftshader"), chromedp.Flag("enable-unsafe-swiftshader", true))
	}
	if r.Chrome != "" {
		opts = append(opts, chromedp.ExecPath(r.Chrome))
	} else if runtime.GOOS == "windows" {
		for _, c := range candidatosChrome() {
			if _, err := os.Stat(c); err == nil {
				opts = append(opts, chromedp.ExecPath(c))
				break
			}
		}
	}
	actx, cancelA := chromedp.NewExecAllocator(ctx, opts...)
	defer cancelA()
	bctx, cancelB := chromedp.NewContext(actx)
	defer cancelB()

	if _, err := chromedp.Run(bctx, chromedp.Navigate(pagina)); err != nil {
		return fmt.Errorf("abrir %s: %w", pagina, err)
	}
	espera := r.Espera
	if espera == 0 {
		espera = 90 * time.Second
	}
	var info infoRec
	limite := time.Now().Add(espera)
	for {
		var ok bool
		v, err := chromedp.Run(bctx, chromedp.Evaluate[*infoRec](`(()=>{const r=window.__fsRec; if(!r) return null; return {listo:r.listo,error:r.error||'',ancho:r.ancho,alto:r.alto,fps:r.fps,cuadros:r.cuadros,duracion:r.duracion}})()`))
		if err == nil && v != nil {
			info = *v
			ok = info.Listo || info.Error != ""
		}
		if ok {
			break
		}
		if time.Now().After(limite) {
			return errors.New("la página no entró en modo grabación (window.__fsRec)")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	if info.Error != "" {
		return fmt.Errorf("modo grabación: %s", info.Error)
	}
	if info.Cuadros <= 0 || info.Fps <= 0 || info.Ancho <= 0 {
		return fmt.Errorf("modo grabación inválido: %+v", info)
	}

	bitrate := tasaBits(info.Ancho*info.Alto, info.Dur)
	if r.Bitrate > 0 && r.Bitrate < bitrate {
		bitrate = r.Bitrate
	}
	tmp := dst + ".tmp.mp4"
	defer os.Remove(tmp)
	enc := r.EncoderElegido()
	cmd, stdin, stderr, err := r.ffmpegCmd(ctx, enc, info.Fps, bitrate, tmp)
	if err != nil {
		return err
	}
	escribir := func() error {
		for k := 0; k < info.Cuadros; k++ {
			b64, err := chromedp.Run(bctx, chromedp.Evaluate[string](fmt.Sprintf("window.__fsRec.cuadro(%d)", k), chromedp.EvalAwaitPromise))
			if err != nil {
				return fmt.Errorf("cuadro %d: %w", k, err)
			}
			jpg, err := base64.StdEncoding.DecodeString(b64)
			if err != nil || len(jpg) == 0 {
				return fmt.Errorf("cuadro %d vacío", k)
			}
			if _, err := stdin.Write(jpg); err != nil {
				return fmt.Errorf("ffmpeg: %w (%s)", err, recorte(stderr.String()))
			}
		}
		return nil
	}
	errW := escribir()
	stdin.Close()
	errF := cmd.Wait()
	if errW != nil {
		return errW
	}
	if errF != nil {
		if enc == "h264_nvenc" && r.Encoder == "" {
			// NVENC ocupado o sin sesiones libres: reintenta con libx264
			log.Printf("simvideo: nvenc falló (%v), reintento con libx264", errF)
			r.encoder = "libx264"
			return r.Render(ctx, pagina, dst)
		}
		return fmt.Errorf("ffmpeg: %w (%s)", errF, recorte(stderr.String()))
	}
	st, err := os.Stat(tmp)
	if err != nil {
		return err
	}
	if st.Size() > MaxBytes {
		return fmt.Errorf("video de %d bytes > 16 MB", st.Size())
	}
	return os.Rename(tmp, dst)
}

// tasaBits: ~3 Mbps a 720p, 6 Mbps a 1080p, sin pasar de 16 MB (88 % por margen).
func tasaBits(pixeles int, dur float64) int {
	b := 3_000_000
	if pixeles > 1280*720 {
		b = 6_000_000
	}
	if dur > 0 {
		if tope := int(float64(MaxBytes) * 8 * 0.88 / dur); tope < b {
			b = tope
		}
	}
	return b
}

type buffer struct {
	mu sync.Mutex
	b  []byte
}

func (w *buffer) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.b) < 1<<16 {
		w.b = append(w.b, p...)
	}
	return len(p), nil
}
func (w *buffer) String() string { w.mu.Lock(); defer w.mu.Unlock(); return string(w.b) }

func (r *ChromeFFmpeg) ffmpegCmd(ctx context.Context, enc string, fps, bitrate int, out string) (*exec.Cmd, io.WriteCloser, *buffer, error) {
	br := strconv.Itoa(bitrate)
	args := []string{"-hide_banner", "-loglevel", "error", "-y",
		"-f", "image2pipe", "-c:v", "mjpeg", "-framerate", strconv.Itoa(fps), "-i", "-"}
	switch enc {
	case "h264_nvenc":
		args = append(args, "-c:v", "h264_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "vbr", "-cq", "21",
			"-b:v", br, "-maxrate", br, "-bufsize", strconv.Itoa(bitrate*2), "-profile:v", "high", "-bf", "2", "-g", strconv.Itoa(fps*2))
	default:
		args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
			"-maxrate", br, "-bufsize", strconv.Itoa(bitrate*2), "-profile:v", "high", "-g", strconv.Itoa(fps*2))
	}
	args = append(args, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out)
	cmd := exec.CommandContext(ctx, r.ffmpeg(), args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, nil, err
	}
	stderr := &buffer{}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return nil, nil, nil, fmt.Errorf("ffmpeg: %w", err)
	}
	return cmd, stdin, stderr, nil
}

func recorte(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 400 {
		return s[len(s)-400:]
	}
	return s
}
