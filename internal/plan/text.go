package plan

import (
	"fmt"
	"math"
	"strings"

	"fieldshift/internal/contract"
	"fieldshift/internal/fao56"
	"fieldshift/internal/geo"
	"fieldshift/internal/sim"
)

// lang textos en español (voseo guatemalteco, sencillo) o inglés.
type lang string

func (l lang) t(es, en string) string {
	if l == "en" {
		return en
	}
	return es
}

func (l lang) f(es, en string, a ...any) string { return fmt.Sprintf(l.t(es, en), a...) }

var mesES = []string{"ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"}
var mesEN = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

// date "05-14" → "14 may" / "May 14".
func (l lang) date(mmdd string) string {
	var m, d int
	fmt.Sscanf(mmdd, "%d-%d", &m, &d)
	if m < 1 || m > 12 {
		return mmdd
	}
	if l == "en" {
		return fmt.Sprintf("%s %d", mesEN[m-1], d)
	}
	return fmt.Sprintf("%d %s", d, mesES[m-1])
}

func (l lang) cropName(c fao56.Crop) string {
	en := map[string]string{"maize": "maize", "bean": "beans", "sorghum": "sorghum", "mucuna": "velvet bean (mucuna)", "canavalia": "jack bean (canavalia)"}
	es := map[string]string{"maize": "maíz", "bean": "frijol", "sorghum": "maicillo (sorgo)", "mucuna": "mucuna (frijol abono)", "canavalia": "canavalia (frijol de puerco)"}
	if l == "en" {
		return en[c.ID]
	}
	return es[c.ID]
}

func (l lang) stage(c fao56.Crop, st int) string {
	es := []string{"nacimiento", "crecimiento", "floración", "llenado de grano"}
	en := []string{"establishment", "vegetative growth", "flowering", "grain filling"}
	if l == "en" {
		return en[st]
	}
	return es[st]
}

func (l lang) zona(m *geo.Municipio, s *sim.Site) string {
	return l.f("%s, %s · zona climática NASA POWER de ~50 km (celda %s) · %0.f m de altura · pendiente media %0.f %% (SRTM)",
		"%s, %s · NASA POWER climate zone of ~50 km (cell %s) · %0.f m elevation · mean slope %0.f %% (SRTM)",
		m.Name, m.Dept, m.Cell, m.ElevM, m.SlopePct)
}

func (l lang) mainLabel(req contract.PlanRequest, main fao56.Crop) string {
	if req.Cultivo == "milpa" {
		return l.t("milpa (maíz + frijol)", "milpa (maize + beans)")
	}
	return l.cropName(main)
}

func (l lang) describe(est *contract.Estrategia, r sim.StratResult, req contract.PlanRequest, cfg sim.Config, cl *sim.Climatology, s *sim.Site, main fao56.Crop) {
	ml := l.mainLabel(req, main)
	switch r.ID {
	case "S0":
		est.Nombre = l.t("Como lo hacés hoy", "What you do today")
		est.Descripcion = l.f("%s en Primera; el rastrojo se quema o se retira y el suelo queda desnudo en la época seca.",
			"%s in Primera; crop residue is burned or removed and the soil stays bare in the dry season.", capital(ml))
		est.Secuencia = []string{l.f("Primera: %s", "Primera: %s", ml), l.t("Postrera: nada", "Postrera: none"), l.t("Seca: suelo desnudo", "Dry season: bare soil")}
		est.Calendario = []contract.Periodo{
			{Tipo: "primera", Nombre: l.f("Primera: %s", "Primera: %s", ml), Inicio: sim.MMDD(r.SowDOYP50), Fin: sim.MMDD(r.SowDOYP50 + float64(main.Season()))},
			{Tipo: "suelo_desnudo", Nombre: l.t("Suelo desnudo", "Bare soil"), Inicio: sim.MMDD(wrap(r.SowDOYP50 + float64(main.Season()) + 1)), Fin: sim.MMDD(wrap(r.SowDOYP50 + 20))},
		}
	case "S1":
		post := l.cropName(*r.Def.Post)
		est.Nombre = l.f("Relevo de %s en Postrera", "%s relay in Postrera", post)
		if l == "en" {
			est.Nombre = capital(strings.Replace(est.Nombre, "beans relay", "bean relay", 1))
		}
		est.Descripcion = l.f("%s en Primera y %s sembrado en relevo cuando el maíz dobla; se deja la mitad del rastrojo sobre el suelo.",
			"%s in Primera and %s relay-planted when the maize is doubled over; half of the residue stays on the soil.", capital(ml), post)
		est.Secuencia = []string{l.f("Primera: %s", "Primera: %s", ml), l.f("Postrera: %s", "Postrera: %s", post), l.t("Seca: rastrojo", "Dry season: crop residue")}
		pe := r.PostDOYP50 + float64(s.Scaled(*r.Def.Post).Season())
		est.Calendario = []contract.Periodo{
			{Tipo: "primera", Nombre: l.f("Primera: %s", "Primera: %s", ml), Inicio: sim.MMDD(r.SowDOYP50), Fin: sim.MMDD(r.SowDOYP50 + float64(main.Season()))},
			{Tipo: "postrera", Nombre: l.f("Postrera: %s", "Postrera: %s", post), Inicio: sim.MMDD(r.PostDOYP50), Fin: sim.MMDD(wrap(pe))},
		}
		if r.BareDays > 30 {
			est.Calendario = append(est.Calendario, contract.Periodo{Tipo: "suelo_desnudo", Nombre: l.t("Suelo casi desnudo", "Nearly bare soil"),
				Inicio: sim.MMDD(wrap(r.SowDOYP50 + 20 - float64(r.BareDays))), Fin: sim.MMDD(wrap(r.SowDOYP50 + 20))})
		}
	case "S2":
		cov := l.cropName(*r.Def.Cover)
		est.Nombre = l.f("Milpa con cobertura de %s", "Milpa with %s cover", cov)
		if req.Cultivo != "milpa" {
			est.Nombre = l.f("%s con cobertura de %s", "%s with %s cover", capital(ml), cov)
		}
		est.Descripcion = l.f("%s en Primera y %s sembrada ~50 días después; no se quema: la cobertura y el rastrojo protegen el suelo todo el año.",
			"%s in Primera and %s planted ~50 days later; no burning: the cover and residue protect the soil all year.", capital(ml), cov)
		est.Secuencia = []string{l.f("Primera: %s + %s", "Primera: %s + %s", ml, cov), l.f("Postrera: %s creciendo", "Postrera: growing %s", cov), l.t("Seca: abono verde (mulch)", "Dry season: green manure mulch")}
		ce := r.SowDOYP50 + sim.CoverSowDay + float64(s.Scaled(*r.Def.Cover).Season())
		est.Calendario = []contract.Periodo{
			{Tipo: "primera", Nombre: l.f("Primera: %s", "Primera: %s", ml), Inicio: sim.MMDD(r.SowDOYP50), Fin: sim.MMDD(r.SowDOYP50 + float64(main.Season()))},
			{Tipo: "cobertura", Nombre: l.f("Cobertura: %s", "Cover: %s", cov), Inicio: sim.MMDD(r.SowDOYP50 + sim.CoverSowDay), Fin: sim.MMDD(wrap(ce))},
		}
	}
}

func wrap(doy float64) float64 {
	for doy > 365 {
		doy -= 365
	}
	for doy < 1 {
		doy += 365
	}
	return doy
}

func capital(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	return strings.ToUpper(string(r[0])) + string(r[1:])
}

func (l lang) fichas(p *contract.Plan, res []sim.StratResult, req contract.PlanRequest, cfg sim.Config, cl *sim.Climatology, s *sim.Site, main fao56.Crop) {
	by := map[string]sim.StratResult{}
	for _, r := range res {
		by[r.ID] = r
	}
	s0 := by["S0"]
	src := l.t("NASA POWER 2001–2025", "NASA POWER 2001–2025")
	for i := range p.Estrategias {
		e := &p.Estrategias[i]
		r := by[e.ID]
		f := contract.Ficha{}
		dLoss := (s0.LossRate - r.LossRate) * 10
		dEro := s0.ErosionT[1] - r.ErosionT[1]
		dOM := r.OM[5] - r.OM[0]
		common := []string{
			l.f("Balance de agua FAO-56 día por día con el clima real de %d temporadas (%s): canícula típica del %s al %s.",
				"Daily FAO-56 water balance with the real weather of %d seasons (%s): typical canícula from %s to %s.",
				len(s.ClimYears()), src, l.date(p.CaniculaTipica.Inicio), l.date(p.CaniculaTipica.Fin)),
			l.f("Monte Carlo de %d secuencias de 10 temporadas, con fecha de siembra y agua del suelo inciertas.",
				"Monte Carlo of %d sequences of 10 seasons, with uncertain planting date and soil water.", Draws),
		}
		switch e.ID {
		case "S0":
			f.PorQue = []string{
				l.t("Es lo que hacés hoy: sirve de punto de comparación para las otras opciones.", "It is what you do today: the baseline to compare the other options."),
				l.f("Con tu clima, perdés en promedio %.1f de cada 10 temporadas (grano < 70 %% de lo normal).", "With your weather, on average you lose %.1f of every 10 seasons (grain < 70%% of normal).", r.LossRate*10),
			}
			f.Evidencia = append(common, l.f("Pérdida de suelo ≈ %.0f t/ha/año con el rastrojo quemado y el suelo desnudo parte del año (RUSLE, aproximado).",
				"Soil loss ≈ %.0f t/ha/yr with burned residue and bare soil part of the year (RUSLE, approximate).", r.ErosionT[1]))
			f.Beneficios = []string{l.t("Ya la conocés: no necesita semilla, dinero ni trabajo extra.", "You already know it: no extra seed, money or labor."),
				l.f("Cosecha típica: %.0f qq/mz de grano (rango %.0f–%.0f).", "Typical harvest: %.0f qq/mz of grain (range %.0f–%.0f).", r.FoodQQ[1], r.FoodQQ[0], r.FoodQQ[2])}
			f.InfoFaltante = []string{l.t("Tu fecha real de siembra y la variedad de maíz.", "Your actual planting date and maize variety."),
				l.t("Profundidad y textura de tu suelo (usamos valores típicos de la zona).", "Your soil depth and texture (we used typical values for the area).")}
			f.Riesgos = []string{capital(l.f("la %s cae en la canícula en muchos años: revisá con tu extensionista si conviene correr la siembra.",
				"%s often falls in the canícula: check with your extension agent whether to shift planting.", l.stage(main, r.WorstStage))),
				l.f("Suelo desnudo ~%d días al año: erosión en la ladera y pérdida de materia orgánica (%.1f %% → %.1f %% en 5 años, aprox.).",
					"Bare soil ~%d days a year: hillside erosion and organic matter loss (%.1f%% → %.1f%% in 5 years, approx.).", r.BareDays, r.OM[0], r.OM[5])}
		case "S1":
			post := l.cropName(*r.Def.Post)
			f.PorQue = []string{
				l.f("Aprovecha las lluvias de Postrera (desde el %s) con %s: si la Primera falla, todavía hay cosecha.",
					"Uses the Postrera rains (from %s) with %s: if Primera fails, there is still a harvest.", l.date(p.VentanaPostrera.Inicio), post),
				l.f("Baja las temporadas perdidas de %.1f a %.1f de cada 10.", "Cuts lost seasons from %.1f to %.1f of every 10.", s0.LossRate*10, r.LossRate*10),
			}
			f.Evidencia = append(common, l.f("Inicio de Postrera calculado año por año con la regla de Sivakumar (1988); %s de Postrera: %.0f qq/mz típico.",
				"Postrera onset computed year by year with the Sivakumar (1988) rule; Postrera %s: %.0f qq/mz typical.", post, r.PostQQ[1]),
				l.t("El relevo de frijol o maicillo en Postrera es práctica común en el oriente (MAGA; FAO, Corredor Seco).", "Relay beans or sorghum in Postrera is common practice in eastern Guatemala (MAGA; FAO Dry Corridor)."))
			f.Beneficios = []string{l.f("Más comida: %.0f qq/mz en total (rango %.0f–%.0f) y una segunda cosecha para vender.", "More food: %.0f qq/mz in total (range %.0f–%.0f) and a second harvest to sell.", r.FoodQQ[1], r.FoodQQ[0], r.FoodQQ[2]),
				l.f("Menos suelo desnudo: %d días menos al año; erosión ≈ %.0f t/ha/año menos.", "Less bare soil: %d fewer days a year; erosion ≈ %.0f t/ha/yr less.", s0.BareDays-r.BareDays, dEro),
				l.t("El frijol fija nitrógeno y corta el ciclo de plagas del maíz.", "Beans fix nitrogen and break maize pest cycles.")}
			f.InfoFaltante = []string{l.t("Precio local del frijol o maicillo y acceso a semilla.", "Local price of beans or sorghum and access to seed."),
				l.t("Si tu terreno guarda humedad en septiembre (suelos muy delgados se secan rápido).", "Whether your land holds moisture in September (very thin soils dry fast).")}
			f.Riesgos = []string{l.t("Postrera seca en años El Niño: con El Niño conviene maicillo en vez de frijol.", "Dry Postrera in El Niño years: with El Niño, sorghum is safer than beans."),
				l.t("Más trabajo en septiembre, justo cuando doblás el maíz.", "More work in September, right when you double the maize."),
				l.t("Plagas y enfermedades del frijol en lluvias fuertes: revisar con el extensionista.", "Bean pests and diseases in heavy rain: check with the extension agent.")}
		case "S2":
			cov := l.cropName(*r.Def.Cover)
			f.PorQue = []string{
				l.f("La %s cubre el suelo casi todo el año: menos evaporación y más agua que entra a la tierra (escorrentía %.0f → %.0f mm).",
					"The %s covers the soil almost all year: less evaporation and more water soaking in (runoff %.0f → %.0f mm).", cov, s0.RunoffMM, r.RunoffMM),
				l.f("Es la que más cuida el suelo: erosión ≈ %.0f t/ha/año (vs %.0f hoy) y materia orgánica %+.2f puntos en 5 años.",
					"It protects the soil the most: erosion ≈ %.0f t/ha/yr (vs %.0f today) and organic matter %+.2f points in 5 years.", r.ErosionT[1], s0.ErosionT[1], dOM),
			}
			f.Evidencia = append(common, l.t("Sistemas de abono verde con mucuna en laderas de Honduras y Guatemala (Buckles et al. 1998, CIMMYT/IDRC; Bunch 2003).",
				"Velvet-bean green-manure systems on hillsides of Honduras and Guatemala (Buckles et al. 1998, CIMMYT/IDRC; Bunch 2003)."),
				l.t("Efecto del mulch en la evaporación según FAO-56 cap. 7; erosión con RUSLE (Renard et al. 1997).", "Mulch effect on evaporation per FAO-56 ch. 7; erosion with RUSLE (Renard et al. 1997)."))
			f.Beneficios = []string{
				l.f("Fija nitrógeno: el rendimiento del maíz puede subir con los años (hasta +15 %%, aprox.); cosecha típica %.0f qq/mz.", "Fixes nitrogen: maize yield can rise over the years (up to +15%%, approx.); typical harvest %.0f qq/mz.", r.FoodQQ[1]),
				l.f("Suelo desnudo: solo ~%d días al año (vs %d hoy).", "Bare soil: only ~%d days a year (vs %d today).", r.BareDays, s0.BareDays),
				l.t("Menos maleza y no hay que quemar.", "Fewer weeds and no burning needed."),
			}
			if dLoss > 0.2 {
				f.Beneficios = append(f.Beneficios, l.f("Temporadas perdidas: %.1f de cada 10 (vs %.1f hoy).", "Lost seasons: %.1f of every 10 (vs %.1f today).", r.LossRate*10, s0.LossRate*10))
			}
			f.InfoFaltante = []string{l.f("Dónde conseguir semilla de %s y cuánta.", "Where to get %s seed and how much.", cov),
				l.t("Cuánta biomasa logra la cobertura en tu terreno (la estimamos con el balance de agua).", "How much biomass the cover reaches on your land (we estimate it with the water balance)."),
				l.t("Si hay ganado suelto que se coma la cobertura en la seca.", "Whether free-roaming livestock will eat the cover in the dry season.")}
			f.Riesgos = []string{
				l.t("Compite por agua con el maíz si se siembra muy temprano: sembrarla después de la primera limpia.", "Competes with maize for water if planted too early: sow it after the first weeding."),
				l.t("La semilla de mucuna no se come sin preparación (tiene L-dopa).", "Velvet bean seed is not edible without processing (it contains L-dopa)."),
				l.t("El beneficio en el suelo tarda 2–3 años en notarse; validar en una parcela pequeña primero.", "Soil benefits take 2–3 years to show; try it on a small plot first."),
			}
		}
		e.Ficha = f
	}
}

func (l lang) warnings(p *contract.Plan, req contract.PlanRequest, cfg sim.Config) {
	for i := range p.Estrategias {
		e := &p.Estrategias[i]
		e.Advertencias = []string{}
		switch e.ID {
		case "S0":
			if e.SueloDesnudoDias > 150 {
				e.Advertencias = append(e.Advertencias, l.f("El suelo queda desnudo ~%d días al año.", "The soil stays bare ~%d days a year.", e.SueloDesnudoDias))
			}
		case "S1":
			if req.ManoObra == "poca" {
				e.Advertencias = append(e.Advertencias, l.t("Pide mano de obra en septiembre, cuando también cosechás.", "Needs labor in September, when you also harvest."))
			}
			if e.PostreraQQMZ.P50 < 1 {
				e.Advertencias = append(e.Advertencias, l.t("En tu zona el ciclo del maíz es largo (frío) y casi no queda tiempo para la Postrera: compará con S2.",
					"In your area the maize cycle is long (cool weather) and there is hardly time for Postrera: compare with S2."))
			}
			if cfg.Postrera == "sorghum" {
				e.Advertencias = append(e.Advertencias, l.t("Se propone maicillo en Postrera porque aguanta mejor la falta de agua.", "Sorghum is proposed for Postrera because it tolerates drought better."))
			}
		case "S2":
			if !req.SemillaCobertura {
				e.Advertencias = append(e.Advertencias, l.t("Conseguir semilla de cobertura (mucuna o canavalia): preguntá en tu cooperativa o al extensionista del MAGA.",
					"Get cover-crop seed (velvet bean or jack bean): ask your cooperative or the MAGA extension agent."))
			}
			if req.ManoObra == "poca" {
				e.Advertencias = append(e.Advertencias, l.t("Pide trabajo extra al sembrar la cobertura y al chapearla.", "Needs extra work to sow and slash the cover."))
			}
			if req.Ganado {
				e.Advertencias = append(e.Advertencias, l.t("Si el ganado se come la cobertura, el suelo mejora menos: cercá una parte.", "If livestock eat the cover, the soil improves less: fence part of it."))
			}
		}
		if strings.HasPrefix(req.Horizonte, "2040") {
			e.Advertencias = append(e.Advertencias, l.t("Escenario climático 2040, no pronóstico.", "2040 climate scenario, not a forecast."))
		}
	}
}

func (l lang) mlNote(r *MLResult, st string) string {
	better := l.t("la estadística", "statistics")
	if r.Eval.BrierIA < r.Eval.BrierEst {
		better = l.t("la IA", "the AI model")
	}
	return l.f("IA: regresión logística con 4 datos conocidos al sembrar (%s) entrenada con %d temporadas (33 zonas NASA POWER × 2001–2025). Estadística: frecuencia de pérdidas por zona y estado de El Niño. Validación dejando un año fuera: error de Brier IA %.3f vs estadística %.3f (menor es mejor) → acá gana %s. Probabilidad de perder la próxima Primera si El Niño sigue al sembrar: las dos se muestran; el motor usa la estadística.",
		"AI: logistic regression on 4 inputs known at planting (%s) trained on %d seasons (33 NASA POWER zones × 2001–2025). Statistics: loss frequency by zone and El Niño state. Leave-one-year-out validation: Brier error AI %.3f vs statistics %.3f (lower is better) → here %s wins. Probability of losing next Primera if El Niño persists at planting: both are shown; the engine uses statistics.",
		strings.Join(l.features(r.Features), ", "), len(r.Samples), r.Eval.BrierIA, r.Eval.BrierEst, better)
}

func (l lang) uncertainty(p *contract.Plan, s *sim.Site, req contract.PlanRequest) string {
	t := l.f("Datos de una zona de ~50 km (no de tu parcela exacta). Los rangos van del 10 %% al 90 %% de %d temporadas simuladas. El rendimiento puede variar ±30–50 %%: compará opciones, no prometemos quintales. En años El Niño (%v) hoy se pierden %.1f de cada 10 temporadas; en los demás, %.1f.",
		"Data for a ~50 km zone (not your exact plot). Ranges go from the 10%% to the 90%% of %d simulated seasons. Yield can vary ±30–50%%: compare options, we do not promise quintales. In El Niño years (%v) today you lose %.1f of every 10 seasons; in other years, %.1f.",
		Draws*10, p.ENSO.AniosNino, p.ENSO.RiesgoNinoS0, p.ENSO.RiesgoOtrosS0)
	if p.ENSO.Estado == "nino" {
		t += l.f(" El Niño está activo ahora (ONI %.1f, %s).", " El Niño is active now (ONI %.1f, %s).", p.ENSO.ONI, p.ENSO.Trimestre)
	}
	if strings.HasPrefix(req.Horizonte, "2040") {
		t += l.t(" 2040: clima 2001–2025 ajustado con los cambios mensuales de 3 modelos NEX-GDDP-CMIP6; el método no cambia cuántos días secos hay.",
			" 2040: 2001–2025 weather adjusted with monthly changes from 3 NEX-GDDP-CMIP6 models; the method does not change the number of dry days.")
	}
	return t
}

func (l lang) sources(e *Engine) []contract.Fuente {
	f := []contract.Fuente{
		{Dato: "NASA POWER (T2M_MAX, T2M_MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR, GWETROOT)", Origen: l.t("power.larc.nasa.gov (MERRA-2, CERES; lluvia corregida)", "power.larc.nasa.gov (MERRA-2, CERES; bias-corrected rain)"), Periodo: "2001–2026, diario",
			Uso: l.t("ET0 FAO-56, balance de agua, inicio de lluvias, canícula", "FAO-56 ET0, water balance, rainy-season onset, canícula")},
		{Dato: "SRTM (AWS Terrain Tiles)", Origen: "NASA/USGS SRTM vía s3://elevation-tiles-prod", Periodo: "2000", Uso: l.t("altitud (corrección de temperatura) y pendiente (erosión)", "elevation (temperature correction) and slope (erosion)")},
		{Dato: "NOAA CPC ONI", Origen: "cpc.ncep.noaa.gov", Periodo: "2001–2026", Uso: l.t("años El Niño para condicionar el Monte Carlo", "El Niño years to condition the Monte Carlo")},
		{Dato: "geoBoundaries GTM ADM2", Origen: "geoboundaries.org (CONRED/OCHA, CC BY 3.0 IGO)", Periodo: "2021", Uso: l.t("342 municipios; punto en polígono", "342 municipalities; point in polygon")},
		{Dato: "FAO-56 / FAO-33", Origen: "Allen et al. 1998; Doorenbos & Kassam 1979", Periodo: "-", Uso: l.t("Kc, Ky, agua del suelo", "Kc, Ky, soil water")},
		{Dato: "Saxton & Rawls 2006; RUSLE (Renard et al. 1997); Lo et al. 1985", Origen: "Soil Sci. Soc. Am. J.; USDA AH-703; Soil Sci. Soc. Am. J.", Periodo: "-", Uso: l.t("agua disponible y erosión (aproximado)", "available water and erosion (approximate)")},
	}
	if e.CMIP != nil {
		f = append(f, contract.Fuente{Dato: "NASA NEX-GDDP-CMIP6 (ACCESS-CM2, MRI-ESM2-0, MPI-ESM1-2-HR)", Origen: "NCCS THREDDS", Periodo: "2010–2014 vs 2038–2042, SSP2-4.5 y SSP5-8.5",
			Uso: l.t("cambios mensuales de lluvia y temperatura a 2040", "monthly rain and temperature changes to 2040")})
	}
	return f
}

func (l lang) summary(p *contract.Plan, m *geo.Municipio) []string {
	var rec, s0 contract.Estrategia
	for _, e := range p.Estrategias {
		if e.Recomendada {
			rec = e
		}
		if e.ID == "S0" {
			s0 = e
		}
	}
	out := []string{
		l.f("📍 %s, %s · zona NASA POWER (~50 km)", "📍 %s, %s · NASA POWER zone (~50 km)", m.Name, m.Dept),
		l.f("🌱 Primera: sembrá entre el %s y el %s (lo más común: desde el %s, con la tierra mojada).",
			"🌱 Primera: plant between %s and %s (most common: from %s, with moist soil).", l.date(p.VentanaPrimera.Inicio), l.date(p.VentanaPrimera.Fin), l.date(p.SiembraAqui)),
	}
	if p.CaniculaTipica.Inicio != "" { // sin lluvia bimodal no hay canícula (ronda 6: salía «Canícula típica:  al »)
		out = append(out, l.f("🌵 Canícula típica: %s al %s; la floración cae en esas fechas: es la etapa más sensible.",
			"🌵 Typical canícula: %s to %s; flowering falls around then: the most sensitive stage.", l.date(p.CaniculaTipica.Inicio), l.date(p.CaniculaTipica.Fin)))
	}
	if rec.ID == "S0" || rec.ID == "" {
		out = append(out, l.f("✅ Lo de hoy sigue siendo buena opción: perdés %.1f de cada 10 temporadas.", "✅ What you do today remains a good option: you lose %.1f of every 10 seasons.", s0.RiesgoDe10))
	} else {
		out = append(out, l.f("✅ Mejor para vos: %s (%s) · perdés %.1f de 10 temporadas vs %.1f hoy.",
			"✅ Best for you: %s (%s) · you lose %.1f of 10 seasons vs %.1f today.", rec.ID, rec.Nombre, rec.RiesgoDe10, s0.RiesgoDe10))
	}
	return out
}

var _ = math.Round

func (l lang) features(fs []string) []string {
	if l != "en" {
		return fs
	}
	return []string{"ONI AMJ", "rain Apr 15–May 31 (z)", "root-zone wetness GWETROOT May (z)", "Tmax Apr–May (z)"}
}
