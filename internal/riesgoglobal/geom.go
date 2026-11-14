// Package riesgoglobal: capa de riesgo del globo fuera de Guatemala (ADM1 de México a Panamá
// + Caribe hispano con el motor de Guatemala; ADM0 del resto del mundo con un indicador grueso).
package riesgoglobal

import (
	"math"

	"fieldshift/internal/geo"
)

// Simplify aplica Douglas-Peucker a cada anillo (tol en grados), redondea a dec decimales
// y descarta anillos/polígonos degenerados o más chicos que minArea (grados²).
// Siempre conserva el polígono más grande.
func Simplify(polys []geo.Polygon, tol float64, dec int, minArea float64) []geo.Polygon {
	big, bigA := -1, -1.0
	for i, p := range polys {
		if len(p) > 0 {
			if a := math.Abs(RingArea(p[0])); a > bigA {
				big, bigA = i, a
			}
		}
	}
	var out []geo.Polygon
	for i, p := range polys {
		if len(p) == 0 {
			continue
		}
		if i != big && math.Abs(RingArea(p[0])) < minArea {
			continue
		}
		var np geo.Polygon
		for k, r := range p {
			sr := roundRing(dp(r, tol), dec)
			if len(sr) < 4 {
				if k == 0 && i == big {
					sr = roundRing(r, dec) // nunca perder el polígono principal
					if len(sr) < 4 {
						break
					}
				} else if k == 0 {
					break
				} else {
					continue
				}
			}
			if k > 0 && math.Abs(RingArea(sr)) < minArea {
				continue
			}
			np = append(np, sr)
		}
		if len(np) > 0 {
			out = append(out, np)
		}
	}
	return out
}

func roundRing(r geo.Ring, dec int) geo.Ring {
	f := math.Pow(10, float64(dec))
	out := make(geo.Ring, 0, len(r))
	for _, pt := range r {
		q := [2]float64{math.Round(pt[0]*f) / f, math.Round(pt[1]*f) / f}
		if n := len(out); n > 0 && out[n-1] == q {
			continue
		}
		out = append(out, q)
	}
	if n := len(out); n > 1 && out[0] != out[n-1] {
		out = append(out, out[0])
	}
	return out
}

// dp Douglas-Peucker iterativo sobre un anillo cerrado.
func dp(r geo.Ring, tol float64) geo.Ring {
	n := len(r)
	if n < 5 {
		return r
	}
	keep := make([]bool, n)
	keep[0], keep[n-1] = true, true
	// anillo cerrado: partir también en el punto más lejano al inicio
	far, fd := 0, -1.0
	for i := 1; i < n-1; i++ {
		if d := math.Hypot(r[i][0]-r[0][0], r[i][1]-r[0][1]); d > fd {
			far, fd = i, d
		}
	}
	keep[far] = true
	stack := [][2]int{{0, far}, {far, n - 1}}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		a, b := s[0], s[1]
		if b-a < 2 {
			continue
		}
		mi, md := -1, tol
		for i := a + 1; i < b; i++ {
			if d := segDist(r[i], r[a], r[b]); d > md {
				mi, md = i, d
			}
		}
		if mi >= 0 {
			keep[mi] = true
			stack = append(stack, [2]int{a, mi}, [2]int{mi, b})
		}
	}
	out := make(geo.Ring, 0, n/4)
	for i, k := range keep {
		if k {
			out = append(out, r[i])
		}
	}
	return out
}

func segDist(p, a, b [2]float64) float64 {
	dx, dy := b[0]-a[0], b[1]-a[1]
	l2 := dx*dx + dy*dy
	if l2 == 0 {
		return math.Hypot(p[0]-a[0], p[1]-a[1])
	}
	t := math.Max(0, math.Min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2))
	return math.Hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy)
}

// RingArea área con signo en grados².
func RingArea(r geo.Ring) float64 {
	s := 0.0
	for i := 0; i+1 < len(r); i++ {
		s += r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1]
	}
	return s / 2
}

// AreaKm2 aproximada (grados² escalados por coseno de la latitud media de cada anillo).
func AreaKm2(polys []geo.Polygon) float64 {
	t := 0.0
	for _, p := range polys {
		for k, r := range p {
			lat := 0.0
			for _, pt := range r {
				lat += pt[1]
			}
			if len(r) > 0 {
				lat /= float64(len(r))
			}
			a := math.Abs(RingArea(r)) * 111.32 * 111.32 * math.Cos(lat*math.Pi/180)
			if k == 0 {
				t += a
			} else {
				t -= a
			}
		}
	}
	return t
}

// Puntos representativos dentro de la región: el centroide interior si es chica; si es grande,
// una grilla regular dentro del territorio con ~1 punto cada umbralKm2 (entre 3 y k).
func Puntos(polys []geo.Polygon, areaKm2 float64, umbralKm2 float64, k int) [][2]float64 {
	lon, lat := geo.Centroid(polys)
	if areaKm2 < umbralKm2 || k <= 1 {
		return [][2]float64{{lon, lat}}
	}
	want := int(math.Min(float64(k), math.Max(3, math.Round(areaKm2/umbralKm2))))
	gr := soloGrandes(polys)
	deg2 := 0.0
	for _, p := range gr {
		deg2 += math.Abs(RingArea(p[0]))
	}
	step := math.Sqrt(deg2 / float64(want))
	var pts [][2]float64
	for it := 0; it < 12; it++ {
		pts = geo.SamplePoints(gr, step)
		if len(pts) > want*3/2 {
			step *= 1.15
		} else if len(pts) < want {
			step /= 1.15
		} else {
			break
		}
	}
	if len(pts) == 0 {
		return [][2]float64{{lon, lat}}
	}
	if len(pts) > k {
		// recorte parejo
		out := make([][2]float64, 0, k)
		for i := 0; i < k; i++ {
			out = append(out, pts[(2*i+1)*len(pts)/(2*k)])
		}
		pts = out
	}
	return pts
}

// soloGrandes: polígonos con al menos 5 % del área del mayor (evita islas remotas).
func soloGrandes(polys []geo.Polygon) []geo.Polygon {
	mx := 0.0
	for _, p := range polys {
		mx = math.Max(mx, math.Abs(RingArea(p[0])))
	}
	var out []geo.Polygon
	for _, p := range polys {
		if math.Abs(RingArea(p[0])) >= 0.05*mx {
			out = append(out, p)
		}
	}
	return out
}
