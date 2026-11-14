// Package cards dibuja la tarjeta PNG del plan (1080×1350) para mandar por WhatsApp:
// franja de huipil, municipio, anillo de 12 meses, las 3 opciones con riesgo X/10 y las fuentes.
package cards

import (
	"bytes"
	"fmt"
	"image/color"
	"image/png"
	"math"
	"strings"
	"sync"

	"github.com/fogleman/gg"
	"github.com/golang/freetype/truetype"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gomedium"
	"golang.org/x/image/font/gofont/goregular"

	"fieldshift/internal/contract"
)

const (
	W = 1080
	H = 1350
)

// Paleta (nota 20): base tierra y hueso, acentos de huipil.
var (
	cHueso    = hex("#F7F1E6")
	cHuesoOsc = hex("#ECE2D0")
	cTierra   = hex("#3B2A1E")
	cTierraMd = hex("#7A6250")
	cGranada  = hex("#B0283F")
	cAnil     = hex("#2B3A8C")
	cMaiz     = hex("#E8B231")
	cJade     = hex("#1E8C6E")
	cJadeClr  = hex("#E3F1EA")
	cVerde    = hex("#6BA539")
	cNaranja  = hex("#D9692B")
	cSueloA   = hex("#C9A884")
	cSueloB   = hex("#A27C5B")
	cHelada   = hex("#7FA7D9")
)

func hex(s string) color.RGBA {
	var r, g, b uint8
	fmt.Sscanf(strings.TrimPrefix(s, "#"), "%02x%02x%02x", &r, &g, &b)
	return color.RGBA{r, g, b, 255}
}

// ---------- fuentes embebidas (Go fonts, licencia BSD) ----------

var (
	fontsOnce sync.Once
	fReg      *truetype.Font
	fMed      *truetype.Font
	fBold     *truetype.Font
	facesMu   sync.Mutex
	faces     = map[string]font.Face{}
)

func loadFonts() {
	fReg, _ = truetype.Parse(goregular.TTF)
	fMed, _ = truetype.Parse(gomedium.TTF)
	fBold, _ = truetype.Parse(gobold.TTF)
}

func face(peso string, size float64) font.Face {
	fontsOnce.Do(loadFonts)
	k := fmt.Sprintf("%s-%.0f", peso, size)
	facesMu.Lock()
	defer facesMu.Unlock()
	if f, ok := faces[k]; ok {
		return f
	}
	f := fReg
	switch peso {
	case "med":
		f = fMed
	case "bold":
		f = fBold
	}
	fc := truetype.NewFace(f, &truetype.Options{Size: size, DPI: 72, Hinting: font.HintingNone})
	faces[k] = fc
	return fc
}

// ---------- textos ----------

type txt map[string][2]string

var L10n = txt{
	"titulo":      {"PLAN DE SIEMBRA", "PLANTING PLAN"},
	"sin_riego":   {"sin riego", "rain-fed"},
	"con_riego":   {"con riego", "irrigated"},
	"calendario":  {"Tu año en 12 meses", "Your year in 12 months"},
	"siembra":     {"SIEMBRA", "PLANT"},
	"primera":     {"Primera", "Primera"},
	"postrera":    {"Postrera", "Postrera"},
	"canicula":    {"Canícula", "Dry spell (canícula)"},
	"suelo":       {"Suelo desnudo", "Bare soil"},
	"ventana":     {"Ventana de siembra", "Planting window"},
	"vulnerable":  {"Etapa sensible", "Sensitive stage"},
	"helada":      {"Helada", "Frost"},
	"opciones":    {"3 OPCIONES PARA TU MILPA", "3 OPTIONS FOR YOUR MILPA"},
	"recomendada": {"RECOMENDADA", "RECOMMENDED"},
	"riesgo":      {"riesgo", "risk"},
	"perdidas":    {"temporadas perdidas de cada 10", "seasons lost out of 10"},
	"datos":       {"Datos: ", "Data: "},
	"consulta":    {"Consultá con tu extensionista antes de decidir.", "Check with your local extension agent before deciding."},
	"ejemplo":     {"DATOS DE EJEMPLO", "SAMPLE DATA"},
	"marca":       {"Field Shift · NASA Space Apps 2026", "Field Shift · NASA Space Apps 2026"},
}

func (x txt) get(L, k string) string {
	if L == "en" {
		return x[k][1]
	}
	return x[k][0]
}

var cultivos = map[string][2]string{
	"milpa": {"Milpa", "Milpa"}, "maiz": {"Maíz", "Maize"}, "frijol": {"Frijol", "Beans"},
	"sorgo": {"Sorgo", "Sorghum"}, "otro": {"Otro cultivo", "Other crop"},
}

var meses = [2][]string{
	{"E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"},
	{"J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"},
}
var mesesCortos = [2][]string{
	{"ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"},
	{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"},
}

// ---------- render ----------

// Render dibuja la tarjeta del plan en PNG.
func Render(p *contract.Plan, idioma string) ([]byte, error) {
	if p == nil {
		return nil, fmt.Errorf("cards: plan nil")
	}
	L := idioma
	if L != "en" {
		L = "es"
	}
	dc := gg.NewContext(W, H)
	dc.SetColor(cHueso)
	dc.Clear()

	huipil(dc, 0, 76)
	cabecera(dc, p, L)
	anillo(dc, p, L)
	opciones(dc, p, L)
	pie(dc, p, L)
	huipilFino(dc, H-26, 26)

	var buf bytes.Buffer
	if err := png.Encode(&buf, dc.Image()); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// huipil: franja tejida (granada, maíz, jade, añil) con rombos y zigzag.
func huipil(dc *gg.Context, y0, h float64) {
	dc.SetColor(cGranada)
	dc.DrawRectangle(0, y0, W, h)
	dc.Fill()
	// hilos de borde
	dc.SetColor(cMaiz)
	dc.DrawRectangle(0, y0+5, W, 4)
	dc.DrawRectangle(0, y0+h-9, W, 4)
	dc.Fill()
	// zigzag superior e inferior en jade
	dc.SetColor(cJade)
	step := 24.0
	for x := -step; x < W+step; x += step {
		dc.MoveTo(x, y0+12)
		dc.LineTo(x+step/2, y0+22)
		dc.LineTo(x+step, y0+12)
		dc.ClosePath()
		dc.MoveTo(x, y0+h-12)
		dc.LineTo(x+step/2, y0+h-22)
		dc.LineTo(x+step, y0+h-12)
		dc.ClosePath()
	}
	dc.Fill()
	// rombos centrales alternados
	cy := y0 + h/2
	cols := []color.RGBA{cMaiz, cHueso, cJade, cHueso}
	i := 0
	for x := 24.0; x < W; x += 48 {
		c := cols[i%len(cols)]
		rombo(dc, x, cy, 15, 12, c)
		rombo(dc, x, cy, 6, 5, cAnil)
		// puntitos entre rombos
		dc.SetColor(cMaiz)
		dc.DrawCircle(x+24, cy, 2.5)
		dc.Fill()
		i++
	}
}

func huipilFino(dc *gg.Context, y0, h float64) {
	dc.SetColor(cAnil)
	dc.DrawRectangle(0, y0, W, h)
	dc.Fill()
	cy := y0 + h/2
	cols := []color.RGBA{cGranada, cMaiz, cJade}
	i := 0
	for x := 16.0; x < W; x += 32 {
		rombo(dc, x, cy, 9, 8, cols[i%3])
		i++
	}
}

func rombo(dc *gg.Context, x, y, rx, ry float64, c color.Color) {
	dc.SetColor(c)
	dc.MoveTo(x, y-ry)
	dc.LineTo(x+rx, y)
	dc.LineTo(x, y+ry)
	dc.LineTo(x-rx, y)
	dc.ClosePath()
	dc.Fill()
}

func cabecera(dc *gg.Context, p *contract.Plan, L string) {
	x := 64.0
	horiz := p.Request.Horizonte
	if horiz == "" {
		horiz = "2026"
	}
	horiz = strings.ReplaceAll(strings.ReplaceAll(horiz, "-ssp245", " · SSP2-4.5"), "-ssp585", " · SSP5-8.5")
	espaciado(dc, L10n.get(L, "titulo")+" · "+strings.ToUpper(horiz), x, 132, face("bold", 24), cAnil, 3)

	dc.SetFontFace(face("bold", 88))
	dc.SetColor(cTierra)
	nombre := p.Municipio.Nombre
	if nombre == "" {
		nombre = p.Request.MunicipioID
	}
	nombre = ajustar(dc, nombre, W-2*x)
	dc.DrawString(nombre, x, 228)

	// fila de chips: departamento · cultivo · riego
	chips := []string{}
	if p.Municipio.Departamento != "" {
		chips = append(chips, p.Municipio.Departamento)
	}
	if c, ok := cultivos[p.Request.Cultivo]; ok {
		chips = append(chips, pick(L, c))
	}
	if p.Request.Riego {
		chips = append(chips, L10n.get(L, "con_riego"))
	} else {
		chips = append(chips, L10n.get(L, "sin_riego"))
	}
	cx := x
	dc.SetFontFace(face("med", 28))
	for i, c := range chips {
		w, _ := dc.MeasureString(c)
		fill, fg := cHuesoOsc, cTierra
		if i == 0 {
			fill, fg = cTierra, cHueso
		}
		dc.SetColor(fill)
		dc.DrawRoundedRectangle(cx, 256, w+36, 48, 24)
		dc.Fill()
		dc.SetColor(fg)
		dc.DrawStringAnchored(c, cx+18+w/2, 280, 0.5, 0.38)
		cx += w + 36 + 12
	}

	// sello "datos NASA" a la derecha
	sx, sy := float64(W-120), 196.0
	dc.SetColor(cAnil)
	dc.DrawCircle(sx, sy, 58)
	dc.Fill()
	dc.SetColor(cMaiz)
	dc.SetLineWidth(3)
	dc.DrawCircle(sx, sy, 50)
	dc.Stroke()
	dc.SetColor(cHueso)
	dc.SetFontFace(face("med", 15))
	dc.DrawStringAnchored(pick(L, [2]string{"DATOS", "DATA"}), sx, sy-20, 0.5, 0.5)
	dc.SetFontFace(face("bold", 26))
	dc.DrawStringAnchored("NASA", sx, sy+2, 0.5, 0.5)
	dc.SetColor(cMaiz)
	dc.SetFontFace(face("med", 14))
	dc.DrawStringAnchored(pick(L, [2]string{"satélites", "satellites"}), sx, sy+24, 0.5, 0.5)

	if p.Generado == "fixture" {
		dc.SetFontFace(face("bold", 18))
		s := L10n.get(L, "ejemplo")
		w, _ := dc.MeasureString(s)
		dc.SetColor(cGranada)
		dc.DrawRoundedRectangle(float64(W)-64-w-28, 100, w+28, 32, 16)
		dc.Fill()
		dc.SetColor(cHueso)
		dc.DrawStringAnchored(s, float64(W)-64-(w+28)/2, 116, 0.5, 0.38)
	}
}

// ---------- anillo de 12 meses ----------

type arco struct {
	tipo, nombre string
	ini, fin     float64 // fracción del año 0..1
	iniS, finS   string
}

func dia(mmdd string) (float64, bool) {
	var m, d int
	if _, err := fmt.Sscanf(mmdd, "%d-%d", &m, &d); err != nil || m < 1 || m > 12 {
		return 0, false
	}
	acum := []int{0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334}
	return (float64(acum[m-1]) + float64(d-1)) / 365.0, true
}

func toArco(pe contract.Periodo) (arco, bool) {
	a, ok1 := dia(pe.Inicio)
	b, ok2 := dia(pe.Fin)
	if !ok1 || !ok2 {
		return arco{}, false
	}
	b += 1.0 / 365 // inclusivo
	if b <= a {
		b += 1
	}
	return arco{tipo: pe.Tipo, nombre: pe.Nombre, ini: a, fin: b, iniS: pe.Inicio, finS: pe.Fin}, true
}

func ang(f float64) float64 { return f*2*math.Pi - math.Pi/2 }

func recomendada(p *contract.Plan) *contract.Estrategia {
	for i := range p.Estrategias {
		if p.Estrategias[i].Recomendada {
			return &p.Estrategias[i]
		}
	}
	if len(p.Estrategias) > 0 {
		return &p.Estrategias[0]
	}
	return nil
}

func anillo(dc *gg.Context, p *contract.Plan, L string) {
	cx, cy := 300.0, 568.0
	rS, wS := 174.0, 46.0 // temporadas
	rR, wR := 134.0, 18.0 // riesgos (canícula, etapa sensible, helada)
	rV, wV := 208.0, 14.0 // ventanas de siembra
	rL := 240.0           // letras de los meses

	espaciado(dc, strings.ToUpper(L10n.get(L, "calendario")), 610, 372, face("bold", 22), cAnil, 3)

	// pistas de fondo
	pista(dc, cx, cy, rS, wS, cHuesoOsc)
	pista(dc, cx, cy, rR, wR, cHuesoOsc)

	var temporadas, riesgos, ventanas []arco
	if rec := recomendada(p); rec != nil {
		for _, pe := range rec.Calendario {
			a, ok := toArco(pe)
			if !ok {
				continue
			}
			switch pe.Tipo {
			case "primera", "postrera", "suelo_desnudo":
				temporadas = append(temporadas, a)
			case "canicula", "vulnerable", "helada":
				riesgos = append(riesgos, a)
			case "siembra":
				ventanas = append(ventanas, a)
			}
		}
	}
	if a, ok := toArco(p.CaniculaTipica); ok {
		a.tipo = "canicula"
		dup := false
		for _, r := range riesgos {
			dup = dup || r.tipo == "canicula"
		}
		if !dup {
			riesgos = append(riesgos, a)
		}
	}
	for _, pe := range []contract.Periodo{p.VentanaPrimera, p.VentanaPostrera} {
		if a, ok := toArco(pe); ok {
			ventanas = append(ventanas, a)
		}
	}

	for _, a := range temporadas {
		switch a.tipo {
		case "primera":
			arcoGrueso(dc, cx, cy, rS, wS, a, cVerde)
		case "postrera":
			arcoGrueso(dc, cx, cy, rS, wS, a, cJade)
		case "suelo_desnudo":
			arcoRayado(dc, cx, cy, rS, wS, a)
		}
	}
	for _, a := range riesgos {
		c := cGranada
		switch a.tipo {
		case "vulnerable":
			c = cNaranja
		case "helada":
			c = cHelada
		}
		arcoGrueso(dc, cx, cy, rR, wR, a, c)
	}
	for _, a := range ventanas {
		arcoGrueso(dc, cx, cy, rV, wV, a, cMaiz)
	}

	// divisiones de meses y letras
	acum := []int{0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365}
	li := 0
	if L == "en" {
		li = 1
	}
	dc.SetFontFace(face("bold", 22))
	for m := 0; m < 12; m++ {
		a := ang(float64(acum[m]) / 365)
		dc.SetColor(cHueso)
		dc.SetLineWidth(3)
		dc.DrawLine(cx+(rR-wR/2-2)*math.Cos(a), cy+(rR-wR/2-2)*math.Sin(a), cx+(rS+wS/2+2)*math.Cos(a), cy+(rS+wS/2+2)*math.Sin(a))
		dc.Stroke()
		mid := ang((float64(acum[m]) + float64(acum[m+1])) / 2 / 365)
		dc.SetColor(cTierraMd)
		dc.DrawStringAnchored(meses[li][m], cx+rL*math.Cos(mid), cy+rL*math.Sin(mid), 0.5, 0.38)
	}

	// marcador "siembra aquí" al inicio de la ventana de Primera
	if a, ok := toArco(p.VentanaPrimera); ok {
		an := ang(a.ini)
		px, py := cx+rV*math.Cos(an), cy+rV*math.Sin(an)
		dc.SetColor(cHueso)
		dc.DrawCircle(px, py, 15)
		dc.Fill()
		dc.SetColor(cTierra)
		dc.DrawCircle(px, py, 10)
		dc.Fill()
		dc.SetColor(cMaiz)
		dc.DrawCircle(px, py, 5)
		dc.Fill()
	}

	// centro: ventana de siembra de Primera
	dc.SetColor(cHueso)
	dc.DrawCircle(cx, cy, rR-wR/2-6)
	dc.Fill()
	espaciadoCentro(dc, L10n.get(L, "siembra"), cx, cy-50, face("bold", 18), cTierraMd, 3)
	dc.SetFontFace(face("bold", 32))
	dc.SetColor(cTierra)
	dc.DrawStringAnchored(rangoCorto(L, p.VentanaPrimera), cx, cy-8, 0.5, 0.5)
	dc.SetFontFace(face("med", 21))
	dc.SetColor(cVerde)
	dc.DrawStringAnchored(L10n.get(L, "primera"), cx, cy+22, 0.5, 0.5)
	if p.VentanaPostrera.Inicio != "" {
		dc.SetFontFace(face("bold", 22))
		dc.SetColor(cTierra)
		dc.DrawStringAnchored(rangoCorto(L, p.VentanaPostrera), cx, cy+58, 0.5, 0.5)
		dc.SetFontFace(face("med", 19))
		dc.SetColor(cJade)
		dc.DrawStringAnchored(L10n.get(L, "postrera"), cx, cy+84, 0.5, 0.5)
	}

	// leyenda a la derecha
	type item struct {
		c      color.RGBA
		rayado bool
		nombre string
		rango  string
	}
	var items []item
	add := func(tipo string, c color.RGBA, ray bool, clave string, as []arco) {
		for _, a := range as {
			if a.tipo == tipo {
				items = append(items, item{c, ray, L10n.get(L, clave), rangoArco(L, a)})
				return
			}
		}
	}
	add("primera", cVerde, false, "primera", temporadas)
	add("canicula", cGranada, false, "canicula", riesgos)
	add("vulnerable", cNaranja, false, "vulnerable", riesgos)
	add("helada", cHelada, false, "helada", riesgos)
	add("postrera", cJade, false, "postrera", temporadas)
	add("suelo_desnudo", cSueloA, true, "suelo", temporadas)
	var vs []string
	for _, pe := range []contract.Periodo{p.VentanaPrimera, p.VentanaPostrera} {
		if a, ok := toArco(pe); ok {
			vs = append(vs, rangoArco(L, a))
		}
	}
	if len(vs) > 0 {
		items = append(items, item{cMaiz, false, L10n.get(L, "ventana"), strings.Join(vs, " · ")})
	}
	lx, ly := 610.0, 400.0
	gap := 68.0
	if len(items) > 6 {
		gap = 58
	}
	for _, it := range items {
		if it.rayado {
			dc.SetColor(cSueloA)
			dc.DrawRoundedRectangle(lx, ly, 40, 40, 10)
			dc.Fill()
			dc.Push()
			dc.DrawRoundedRectangle(lx, ly, 40, 40, 10)
			dc.Clip()
			dc.SetColor(cSueloB)
			dc.SetLineWidth(5)
			for k := -40.0; k < 80; k += 12 {
				dc.DrawLine(lx+k, ly+40, lx+k+40, ly)
			}
			dc.Stroke()
			dc.ResetClip()
			dc.Pop()
		} else {
			dc.SetColor(it.c)
			dc.DrawRoundedRectangle(lx, ly, 40, 40, 10)
			dc.Fill()
		}
		dc.SetFontFace(face("bold", 27))
		dc.SetColor(cTierra)
		dc.DrawString(it.nombre, lx+58, ly+18)
		dc.SetFontFace(face("reg", 23))
		dc.SetColor(cTierraMd)
		dc.DrawString(it.rango, lx+58, ly+46)
		ly += gap
	}
}

func pista(dc *gg.Context, cx, cy, r, w float64, c color.Color) {
	dc.SetColor(c)
	dc.SetLineWidth(w)
	dc.SetLineCap(gg.LineCapButt)
	dc.DrawCircle(cx, cy, r)
	dc.Stroke()
}

func arcoGrueso(dc *gg.Context, cx, cy, r, w float64, a arco, c color.Color) {
	dc.SetColor(c)
	dc.SetLineWidth(w)
	dc.SetLineCap(gg.LineCapButt)
	dc.NewSubPath()
	dc.DrawArc(cx, cy, r, ang(a.ini), ang(a.fin))
	dc.Stroke()
}

func arcoRayado(dc *gg.Context, cx, cy, r, w float64, a arco) {
	arcoGrueso(dc, cx, cy, r, w, a, cSueloA)
	// recorte con la forma del arco y rayas diagonales
	dc.Push()
	dc.ClearPath()
	n := 64
	for i := 0; i <= n; i++ {
		t := ang(a.ini + (a.fin-a.ini)*float64(i)/float64(n))
		x, y := cx+(r+w/2)*math.Cos(t), cy+(r+w/2)*math.Sin(t)
		if i == 0 {
			dc.MoveTo(x, y)
		} else {
			dc.LineTo(x, y)
		}
	}
	for i := n; i >= 0; i-- {
		t := ang(a.ini + (a.fin-a.ini)*float64(i)/float64(n))
		dc.LineTo(cx+(r-w/2)*math.Cos(t), cy+(r-w/2)*math.Sin(t))
	}
	dc.ClosePath()
	dc.Clip()
	dc.SetColor(cSueloB)
	dc.SetLineWidth(5)
	for k := -2 * r; k < 2*r; k += 14 {
		dc.DrawLine(cx-r-w+k, cy+r+w, cx+r+w+k, cy-r-w)
	}
	dc.Stroke()
	dc.ResetClip()
	dc.Pop()
}

func rangoCorto(L string, pe contract.Periodo) string {
	a, ok := toArco(pe)
	if !ok {
		return "—"
	}
	return rangoArco(L, a)
}

func rangoArco(L string, a arco) string {
	return fechaCorta(L, a.iniS) + " – " + fechaCorta(L, a.finS)
}

func fechaCorta(L, mmdd string) string {
	var m, d int
	if _, err := fmt.Sscanf(mmdd, "%d-%d", &m, &d); err != nil || m < 1 || m > 12 {
		return mmdd
	}
	if L == "en" {
		return fmt.Sprintf("%s %d", mesesCortos[1][m-1], d)
	}
	return fmt.Sprintf("%d %s", d, mesesCortos[0][m-1])
}

// ---------- 3 opciones ----------

func riesgo(s *contract.Estrategia) int {
	r := int(s.PerdidasDe10.P50 + 0.5)
	return max(0, min(10, r))
}

func colorRiesgo(r int) color.RGBA {
	switch {
	case r <= 3:
		return cJade
	case r <= 6:
		return cMaiz
	}
	return cGranada
}

func opciones(dc *gg.Context, p *contract.Plan, L string) {
	x0, y := 64.0, 860.0
	espaciado(dc, L10n.get(L, "opciones"), x0, y-22, face("bold", 22), cAnil, 3)
	dc.SetFontFace(face("reg", 20))
	dc.SetColor(cTierraMd)
	dc.DrawStringAnchored(L10n.get(L, "riesgo")+" = "+L10n.get(L, "perdidas"), float64(W)-64, y-22, 1, 0)

	n := min(3, len(p.Estrategias))
	alto, gap := 116.0, 14.0
	for i := 0; i < n; i++ {
		s := &p.Estrategias[i]
		bx, by, bw := x0, y, float64(W)-2*x0
		if s.Recomendada {
			dc.SetColor(cJadeClr)
			dc.DrawRoundedRectangle(bx, by, bw, alto, 22)
			dc.Fill()
			dc.SetColor(cJade)
			dc.SetLineWidth(4)
			dc.DrawRoundedRectangle(bx, by, bw, alto, 22)
			dc.Stroke()
		} else {
			dc.SetColor(color.RGBA{255, 255, 255, 255})
			dc.DrawRoundedRectangle(bx, by, bw, alto, 22)
			dc.Fill()
			dc.SetColor(cHuesoOsc)
			dc.SetLineWidth(2)
			dc.DrawRoundedRectangle(bx, by, bw, alto, 22)
			dc.Stroke()
		}
		// número
		nc := cTierra
		if s.Recomendada {
			nc = cJade
		}
		dc.SetColor(nc)
		dc.DrawCircle(bx+52, by+alto/2, 28)
		dc.Fill()
		dc.SetColor(cHueso)
		dc.SetFontFace(face("bold", 30))
		dc.DrawStringAnchored(fmt.Sprint(i+1), bx+52, by+alto/2, 0.5, 0.38)

		// medidor de riesgo a la derecha
		r := riesgo(s)
		mx := bx + bw - 330
		for k := 0; k < 10; k++ {
			c := cHuesoOsc
			if k < r {
				c = colorRiesgo(r)
			}
			dc.SetColor(c)
			dc.DrawRoundedRectangle(mx+float64(k)*20, by+42, 14, 32, 4)
			dc.Fill()
		}
		dc.SetColor(colorRiesgo(r))
		dc.SetFontFace(face("bold", 44))
		dc.DrawStringAnchored(fmt.Sprint(r), bx+bw-78, by+alto/2-4, 1, 0.38)
		dc.SetColor(cTierraMd)
		dc.SetFontFace(face("med", 22))
		dc.DrawStringAnchored("/10", bx+bw-74, by+alto/2-2, 0, 0.38)
		dc.SetFontFace(face("reg", 17))
		dc.DrawStringAnchored(L10n.get(L, "riesgo"), mx+100, by+94, 0.5, 0)

		// nombre y descripción
		tx := bx + 100
		maxw := mx - tx - 24
		ty := by + 52
		if s.Recomendada {
			dc.SetFontFace(face("bold", 17))
			b := L10n.get(L, "recomendada")
			w, _ := dc.MeasureString(b)
			dc.SetColor(cJade)
			dc.DrawRoundedRectangle(tx, by+12, w+20, 24, 12)
			dc.Fill()
			dc.SetColor(cHueso)
			dc.DrawStringAnchored(b, tx+10+w/2, by+24, 0.5, 0.38)
			ty = by + 68
		}
		dc.SetFontFace(face("bold", 29))
		dc.SetColor(cTierra)
		dc.DrawString(ajustar(dc, s.Nombre, maxw), tx, ty)
		dc.SetFontFace(face("reg", 21))
		dc.SetColor(cTierraMd)
		dc.DrawString(ajustar(dc, s.Descripcion, maxw), tx, ty+30)
		y += alto + gap
	}
}

// ---------- pie ----------

func pie(dc *gg.Context, p *contract.Plan, L string) {
	y := 1272.0
	dc.SetColor(cHuesoOsc)
	dc.SetLineWidth(2)
	dc.DrawLine(64, y-30, float64(W)-64, y-30)
	dc.Stroke()

	var xs []string
	seen := map[string]bool{}
	for _, f := range p.Fuentes {
		if f.Dato != "" && !seen[f.Dato] {
			seen[f.Dato] = true
			xs = append(xs, f.Dato)
		}
	}
	if len(xs) == 0 {
		xs = []string{"NASA POWER", "GPM IMERG"}
	}
	dc.SetFontFace(face("med", 22))
	dc.SetColor(cTierra)
	dc.DrawString(ajustar(dc, L10n.get(L, "datos")+strings.Join(xs, " · "), float64(W)-128), 64, y)
	dc.SetFontFace(face("reg", 20))
	dc.SetColor(cTierraMd)
	dc.DrawString(L10n.get(L, "consulta"), 64, y+32)
	dc.SetFontFace(face("bold", 20))
	dc.SetColor(cGranada)
	dc.DrawStringAnchored(L10n.get(L, "marca"), float64(W)-64, y+32, 1, 0)
}

// ---------- utilidades de texto ----------

// ajustar recorta con "…" hasta que quepa en maxw.
func ajustar(dc *gg.Context, s string, maxw float64) string {
	if w, _ := dc.MeasureString(s); w <= maxw {
		return s
	}
	r := []rune(s)
	for len(r) > 1 {
		r = r[:len(r)-1]
		c := strings.TrimRight(string(r), " ,.·") + "…"
		if w, _ := dc.MeasureString(c); w <= maxw {
			return c
		}
	}
	return s
}

// espaciado dibuja texto con espaciado entre letras (versalitas de etiqueta).
func espaciado(dc *gg.Context, s string, x, y float64, f font.Face, c color.Color, track float64) {
	dc.SetFontFace(f)
	dc.SetColor(c)
	for _, r := range s {
		ch := string(r)
		dc.DrawString(ch, x, y)
		w, _ := dc.MeasureString(ch)
		x += w + track
	}
}

func espaciadoCentro(dc *gg.Context, s string, cx, y float64, f font.Face, c color.Color, track float64) {
	dc.SetFontFace(f)
	total := 0.0
	for _, r := range s {
		w, _ := dc.MeasureString(string(r))
		total += w + track
	}
	espaciado(dc, s, cx-(total-track)/2, y, f, c, track)
}

func pick(L string, p [2]string) string {
	if L == "en" {
		return p[1]
	}
	return p[0]
}
