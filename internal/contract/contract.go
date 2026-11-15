// Package contract fija los tipos compartidos entre agentes (motor, bot, alertas, web, integrador).
// Cambiarlo exige avisar en COORDINACION.md. Campos nuevos: solo agregar, nunca renombrar.
package contract

// PlanRequest es lo que el agricultor responde (por WhatsApp o en la web).
type PlanRequest struct {
	MunicipioID      string   `json:"municipio_id"`  // id de data/municipios.json
	Lat              *float64 `json:"lat,omitempty"` // si mandó ubicación
	Lon              *float64 `json:"lon,omitempty"`
	Cultivo          string   `json:"cultivo"` // milpa | maiz | frijol | sorgo | otro
	AreaValor        float64  `json:"area_valor"`
	AreaUnidad       string   `json:"area_unidad"` // cuerda | manzana | ha
	Riego            bool     `json:"riego"`
	Ganado           bool     `json:"ganado"`                  // necesita forraje
	ManoObra         string   `json:"mano_obra"`               // poca | normal | mucha
	SemillaCobertura bool     `json:"semilla_cobertura"`       // tiene acceso a mucuna/canavalia
	Prioridad        string   `json:"prioridad"`               // comida | agua | suelo | ingreso
	FechaSiembra     string   `json:"fecha_siembra,omitempty"` // YYYY-MM-DD
	Horizonte        string   `json:"horizonte"`               // 2026 | 2040-ssp245 | 2040-ssp585
	ElNino           *bool    `json:"el_nino,omitempty"`       // nil = según ONI actual
	Idioma           string   `json:"idioma"`                  // es | en
	// Agregado por el motor (14-nov, sandbox): riego en mm por semana; si viene > 0 reemplaza a Riego (auxilio).
	RiegoMMSemana *float64 `json:"riego_mm_semana,omitempty"`
}

type Rango struct {
	P10 float64 `json:"p10"`
	P50 float64 `json:"p50"`
	P90 float64 `json:"p90"`
}

// Periodo del calendario. Inicio/Fin en MM-DD.
type Periodo struct {
	Tipo   string `json:"tipo"` // primera | canicula | postrera | suelo_desnudo | siembra | helada | vulnerable
	Nombre string `json:"nombre"`
	Inicio string `json:"inicio"`
	Fin    string `json:"fin"`
}

// Ficha de 5 puntos que exige el reto.
type Ficha struct {
	PorQue       []string `json:"por_que"`
	Evidencia    []string `json:"evidencia"`
	Beneficios   []string `json:"beneficios"`
	InfoFaltante []string `json:"info_faltante"`
	Riesgos      []string `json:"riesgos"` // requieren revisión local
}

type Estrategia struct {
	ID               string    `json:"id"` // S0 | S1 | S2
	Nombre           string    `json:"nombre"`
	Descripcion      string    `json:"descripcion"`
	Secuencia        []string  `json:"secuencia"`      // temporadas en orden
	PerdidasDe10     Rango     `json:"perdidas_de_10"` // temporadas perdidas de cada 10
	DeficitAguaMM    Rango     `json:"deficit_agua_mm"`
	RendimientoQQMZ  Rango     `json:"rendimiento_qq_mz"`
	SueloMO          []float64 `json:"suelo_mo"`     // índice materia orgánica año 0..5
	ErosionTHa       []float64 `json:"erosion_t_ha"` // año 0..5
	SueloDesnudoDias int       `json:"suelo_desnudo_dias"`
	Calendario       []Periodo `json:"calendario"`
	Ficha            Ficha     `json:"ficha"`
	Recomendada      bool      `json:"recomendada"`
	Advertencias     []string  `json:"advertencias"`

	// Agregados por el motor (2026-11-14):
	RiesgoDe10      float64            `json:"riesgo_de_10"`     // media de temporadas perdidas de cada 10
	Puntajes        map[string]float64 `json:"puntajes"`         // comida | agua | suelo | ingreso, 0..10 (10 = mejor)
	IngresoQMZ      Rango              `json:"ingreso_q_mz"`     // quetzales por manzana (precios de referencia)
	PostreraQQMZ    Rango              `json:"postrera_qq_mz"`   // grano del relevo de Postrera
	TotalQQ         Rango              `json:"total_qq"`         // grano total para el área del agricultor
	EscorrentiaMM   float64            `json:"escorrentia_mm"`   // agua que se escurre por temporada
	EtapaVulnerable string             `json:"etapa_vulnerable"` // etapa del cultivo más sensible a la falta de agua
	SueloMOP10      []float64          `json:"suelo_mo_p10"`     // banda de incertidumbre de suelo_mo
	SueloMOP90      []float64          `json:"suelo_mo_p90"`
	Anios           []AnioEstrategia   `json:"anios,omitempty"` // resultado en cada año real 2001–2025
}

// AnioEstrategia resultado de una estrategia en un año real (variante central).
type AnioEstrategia struct {
	Anio      int     `json:"anio"`
	GranoQQMZ float64 `json:"grano_qq_mz"`
	DeficitMM float64 `json:"deficit_mm"`
	Perdida   bool    `json:"perdida"`
	ElNino    bool    `json:"el_nino"`
}

// MesClima climatología mensual (NASA POWER 2001–2025) para el anillo-calendario.
type MesClima struct {
	Mes      int     `json:"mes"` // 1..12
	LluviaMM Rango   `json:"lluvia_mm"`
	ET0MM    float64 `json:"et0_mm"`
	TminC    float64 `json:"tmin_c"`
}

// ENSOInfo estado de El Niño usado en el plan.
type ENSOInfo struct {
	ONI           float64 `json:"oni"`
	Trimestre     string  `json:"trimestre"`
	Estado        string  `json:"estado"`    // nino | nina | neutral
	Condicion     string  `json:"condicion"` // todos | nino | no_nino (años usados en el Monte Carlo)
	AniosNino     []int   `json:"anios_nino"`
	RiesgoNinoS0  float64 `json:"riesgo_nino_s0"` // de 10, solo años El Niño
	RiesgoOtrosS0 float64 `json:"riesgo_otros_s0"`
}

type Fuente struct {
	Dato    string `json:"dato"`
	Origen  string `json:"origen"`
	Periodo string `json:"periodo"`
	Uso     string `json:"uso"`
}

type Municipio struct {
	ID           string  `json:"id"`
	Nombre       string  `json:"nombre"`
	Departamento string  `json:"departamento"`
	Lat          float64 `json:"lat"`
	Lon          float64 `json:"lon"`
}

type AnioValidado struct {
	Anio        int  `json:"anio"`
	Documentada bool `json:"documentada"`
	Detectada   bool `json:"detectada"`
}

type Plan struct {
	Municipio       Municipio    `json:"municipio"`
	Request         PlanRequest  `json:"request"`
	VentanaPrimera  Periodo      `json:"ventana_primera"`
	VentanaPostrera Periodo      `json:"ventana_postrera"`
	CaniculaTipica  Periodo      `json:"canicula_tipica"`
	Estrategias     []Estrategia `json:"estrategias"`
	Incertidumbre   string       `json:"incertidumbre"`
	IAvsEst         struct {
		ProbIA           float64 `json:"prob_ia"`
		ProbEstadistica  float64 `json:"prob_estadistica"`
		ErrorIA          float64 `json:"error_ia"`
		ErrorEstadistica float64 `json:"error_estadistica"`
		Nota             string  `json:"nota"`
	} `json:"ia_vs_estadistica"`
	Validacion struct {
		Detectadas int            `json:"detectadas"`
		Total      int            `json:"total"`
		Detalle    []AnioValidado `json:"detalle"`
	} `json:"validacion"`
	Fuentes  []Fuente `json:"fuentes"`
	Generado string   `json:"generado"`

	// Agregados por el motor (2026-11-14):
	SiembraAqui  string     `json:"siembra_aqui"` // MM-DD: mediana del inicio de lluvias
	Periodos     []Periodo  `json:"periodos"`     // calendario común: primera, canícula, postrera, helada, vulnerable
	ClimaMensual []MesClima `json:"clima_mensual"`
	ENSO         ENSOInfo   `json:"enso"`
	Zona         string     `json:"zona"` // texto: celda NASA POWER, altitud, pendiente
	Suelo        struct {
		Arena        float64 `json:"arena"`
		Arcilla      float64 `json:"arcilla"`
		MO           float64 `json:"mo"`
		ProfundidadM float64 `json:"profundidad_m"`
		Fuente       string  `json:"fuente"`
	} `json:"suelo"`
	AreaManzanas    float64  `json:"area_manzanas"`
	FalsoInicioDe10 float64  `json:"falso_inicio_de_10"` // años con falso inicio de lluvias, de cada 10
	CaniculaDias    Rango    `json:"canicula_dias"`      // racha seca más larga jun–ago
	HeladaDe10      float64  `json:"helada_de_10"`       // años con Tmín ≤ 3 °C (altiplano)
	Resumen         []string `json:"resumen"`            // 4 líneas para WhatsApp, en el idioma pedido
	Motor           string   `json:"motor"`              // versión del motor

	// Agregados por el motor (ronda 3, 14-nov):
	Confianza *SimConfianza `json:"confianza,omitempty"` // de dónde sale la temporada que viene y cuánto confiar
	Sitio     *SitioInfo    `json:"sitio,omitempty"`     // temporadas, bioma y fuentes del punto (sobre todo fuera de Guatemala)

	// Agregado por el motor (ronda 5, 14-nov): fecha de siembra elegida (Request.FechaSiembra) vs recomendada.
	Siembra *SimSiembra `json:"siembra,omitempty"`
}

// Planner lo implementa el motor (internal/plan).
type Planner interface {
	Plan(req PlanRequest) (Plan, error)
}

// Mensajero lo implementan los canales del bot (internal/channels). Las alertas lo usan para enviar.
type Mensajero interface {
	EnviarTexto(tel, texto string) error
	EnviarBotones(tel, texto string, botones []Boton) error
	EnviarImagen(tel string, png []byte, caption string) error
	EnviarPlantilla(tel, plantilla, idioma string, vars []string) error
}

type Boton struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Mensaje del bot hacia el simulador web (POST /api/chat).
type MensajeChat struct {
	From     string  `json:"from"` // bot | user
	Tipo     string  `json:"tipo"` // text | buttons | list | image | location_request | alert
	Texto    string  `json:"texto"`
	Botones  []Boton `json:"botones,omitempty"`
	ImageURL string  `json:"image_url,omitempty"`
	// Agregado por video (14-nov): Tipo "video" → MP4 del sandbox 3D (GET /api/sim/video.mp4?…).
	VideoURL string `json:"video_url,omitempty"`
	// Agregado por integrador3 (14-nov): Tipo "document" → informe técnico PDF (GET /api/informe.pdf?…) + página web.
	DocURL    string `json:"doc_url,omitempty"`
	DocNombre string `json:"doc_nombre,omitempty"`
	LinkURL   string `json:"link_url,omitempty"`
}

type Suscriptor struct {
	ID             string  `json:"id"`
	Telefono       string  `json:"telefono"`
	MunicipioID    string  `json:"municipio_id"`
	Lat            float64 `json:"lat"`
	Lon            float64 `json:"lon"`
	Cultivo        string  `json:"cultivo"`
	Estrategia     string  `json:"estrategia"`
	FechaSiembra   string  `json:"fecha_siembra"`
	Idioma         string  `json:"idioma"`
	Consentimiento string  `json:"consentimiento"`
	Activo         bool    `json:"activo"`
}

type Alerta struct {
	ID           string   `json:"id"`
	SuscriptorID string   `json:"suscriptor_id"`
	MunicipioID  string   `json:"municipio_id"`
	Tipo         string   `json:"tipo"` // canicula | lluvia_fuerte | inicio_lluvias | falso_inicio | perspectiva | helada | seguimiento
	FechaEmision string   `json:"fecha_emision"`
	Inicio       string   `json:"inicio"`
	Dias         int      `json:"dias"`
	Probabilidad float64  `json:"probabilidad"` // 0..1
	Titulo       string   `json:"titulo"`
	Texto        string   `json:"texto"`
	Acciones     []string `json:"acciones"`
	Plantilla    string   `json:"plantilla"`
	Vars         []string `json:"vars"`
}

// ---------- Sandbox 3D (vault nota 25) ----------

// SimRequest pide una línea de tiempo diaria para el sandbox 3D.
type SimRequest struct {
	Plan          PlanRequest `json:"plan"`
	Estrategia    string      `json:"estrategia"`      // S0 | S1 | S2
	RiegoMMSemana float64     `json:"riego_mm_semana"` // 0 = temporal; poco≈10, medio≈20, mucho≈35 (documentar)
	Escenario     string      `json:"escenario"`       // tipico | nino | real-2026 | secuencia | 2040-ssp245 | 2040-ssp585
	Percentil     string      `json:"percentil"`       // p10 | p50 | p90 (para secuencia/típico)
	Anios         int         `json:"anios"`           // 1..10
	Semilla       int64       `json:"semilla"`
	// Agregados por el motor (ronda 5, 14-nov):
	FechaSiembra string `json:"fecha_siembra,omitempty"` // YYYY-MM-DD elegida por el usuario; vacío = la recomendada (si no, Plan.FechaSiembra)
	Desde        string `json:"desde,omitempty"`         // YYYY-MM-DD: recorta la línea de tiempo (vacío = desde el inicio)
	Hasta        string `json:"hasta,omitempty"`         // YYYY-MM-DD: recorta la línea de tiempo (vacío = hasta el fin)
}

// SimCapa estado diario de un cultivo (la milpa trae varias capas: maíz + frijol; S2 agrega mucuna).
type SimCapa struct {
	Cultivo   string    `json:"cultivo"`   // maiz | frijol | sorgo | mucuna | canavalia | otro
	Etapa     []float32 `json:"etapa"`     // -1 sin cultivo; 0 siembra … 1 cosecha
	Cobertura []float32 `json:"cobertura"` // 0..1 dosel
	Salud     []float32 `json:"salud"`     // 0..1 (1 − estrés)
	Altura    []float32 `json:"altura_m"`
}

type SimEvento struct {
	Dia   int     `json:"dia"`  // índice en la línea de tiempo
	Tipo  string  `json:"tipo"` // tormenta | racha_seca | calor | helada | siembra | cosecha | falso_inicio | riego | perdida
	Dias  int     `json:"dias"`
	Valor float64 `json:"valor"` // mm, °C o qq/mz según tipo
	Texto string  `json:"texto"`
}

type SimAnio struct {
	Anio       int     `json:"anio"`      // año simulado (2026, 2027…)
	AnioReal   int     `json:"anio_real"` // de qué año real sale el clima
	GranoQQMZ  float64 `json:"grano_qq_mz"`
	MO         float64 `json:"mo"`
	ErosionTHa float64 `json:"erosion_t_ha"`
	Perdida    bool    `json:"perdida"`
	ElNino     bool    `json:"el_nino"`
}

// SimTimeline columnas diarias (mismo largo = Dias) para animar la escena.
type SimTimeline struct {
	Inicio       string      `json:"inicio"` // YYYY-MM-DD del día 0
	Dias         int         `json:"dias"`
	Fuente       []string    `json:"fuente"` // por día: observado | remuestreado:<año> | pronostico | cmip6:<año>
	LluviaMM     []float32   `json:"lluvia_mm"`
	RiegoMM      []float32   `json:"riego_mm"`
	TmaxC        []float32   `json:"tmax_c"`
	TminC        []float32   `json:"tmin_c"`
	ET0MM        []float32   `json:"et0_mm"`
	AguaSuelo    []float32   `json:"agua_suelo"` // 0..1 fracción del agua disponible
	Escorrentia  []float32   `json:"escorrentia_mm"`
	Nubes        []float32   `json:"nubes"`   // 0..1 derivado de lluvia/radiación
	Viento       []float32   `json:"viento"`  // m/s
	Residuo      []float32   `json:"residuo"` // 0..1 rastrojo/mulch sobre el suelo
	SueloDesnudo []bool      `json:"suelo_desnudo"`
	Capas        []SimCapa   `json:"capas"`
	Eventos      []SimEvento `json:"eventos"`
	Anual        []SimAnio   `json:"anual"`
	P95LluviaMM  float64     `json:"p95_lluvia_mm"` // umbral local de tormenta
	Pendiente    float64     `json:"pendiente_pct"`
	Notas        []string    `json:"notas"`
	Motor        string      `json:"motor"`
	// Agregados por el motor (ronda 3, 14-nov):
	Escenario string        `json:"escenario,omitempty"` // escenario efectivo (pronostico cae a remuestreo-enso sin red)
	Confianza *SimConfianza `json:"confianza,omitempty"`
	// Agregados por el motor (ronda 5, 14-nov):
	Siembra *SimSiembra `json:"siembra,omitempty"` // fecha elegida vs recomendada, cosechas y razones
	Rango   *SimRango   `json:"rango,omitempty"`   // si se pidió Desde/Hasta: qué se recortó
}

// ---------- Ronda 3: confianza de la predicción y motor global ----------

// SimConfianza dice de dónde sale lo que se ve y cuánto confiar (escenario "pronostico" y los demás).
type SimConfianza struct {
	Metodo         string   `json:"metodo"`          // analogo-pronostico | remuestreo-enso | observado | cmip6
	AniosAnalogos  []int    `json:"anios_analogos"`  // año real usado en cada temporada
	AniosBase      int      `json:"anios_base"`      // años de la serie (25 = 2001–2025)
	AniosParecidos int      `json:"anios_parecidos"` // de AniosBase, cuántos tuvieron un resultado de la misma clase que el mostrado
	ProbEscenario  float64  `json:"prob_escenario"`  // 0–1: probabilidad de la clase de temporada mostrada según el pronóstico estacional
	ProbPerdida    float64  `json:"prob_perdida"`    // 0–1: probabilidad de perder la temporada (estrategia pedida)
	CosechaP10     float64  `json:"cosecha_p10"`     // qq/mz
	CosechaP50     float64  `json:"cosecha_p50"`
	CosechaP90     float64  `json:"cosecha_p90"`
	Habilidad      string   `json:"habilidad"` // validación ("detectó 5 de 8 sequías documentadas · Brier 0.155 vs 0.160") o "sin validación local"
	Nivel          string   `json:"nivel"`     // alta | media | baja
	Texto          string   `json:"texto"`     // una frase humana (ES)
	TextoEN        string   `json:"texto_en"`
	Fuentes        []string `json:"fuentes"`

	// detalle opcional (para el informe técnico)
	Clase           string      `json:"clase,omitempty"`       // perdida | regular | buena (clase de la temporada mostrada, milpa de hoy S0)
	ProbClases      *[3]float64 `json:"prob_clases,omitempty"` // prob. de cada clase (pérdida, regular, buena) entre los años parecidos al pronóstico
	ONIPronostico   *float64    `json:"oni_pronostico,omitempty"`
	ONIFuente       string      `json:"oni_fuente,omitempty"`
	DiasPronostico  int         `json:"dias_pronostico,omitempty"`  // días de la línea de tiempo con pronóstico de 16 días
	FechaPronostico string      `json:"fecha_pronostico,omitempty"` // YYYY-MM-DD de la corrida usada
	Regla           string      `json:"regla,omitempty"`            // cómo se decide el nivel
}

// Temporada de lluvias detectada en la climatología (MM-DD).
type Temporada struct {
	Nombre   string  `json:"nombre"` // primera | postrera | lluvias
	Inicio   string  `json:"inicio"`
	Fin      string  `json:"fin"`
	LluviaMM float64 `json:"lluvia_mm"`
}

// SitioInfo resumen de un punto cualquiera del mundo (GET /api/sitio?lat&lon).
type SitioInfo struct {
	ID           string      `json:"id"`
	Nombre       string      `json:"nombre"`
	Pais         string      `json:"pais,omitempty"`
	Lat          float64     `json:"lat"`
	Lon          float64     `json:"lon"`
	ElevM        float64     `json:"elev_m"`
	PendientePct float64     `json:"pendiente_pct"`
	Precalculado bool        `json:"precalculado"` // municipio de Guatemala con datos locales
	Bimodal      bool        `json:"bimodal"`
	Temporadas   []Temporada `json:"temporadas"`
	Canicula     *Periodo    `json:"canicula,omitempty"` // solo si la lluvia es bimodal
	RiesgoDe10   float64     `json:"riesgo_de_10"`       // temporadas difíciles de cada 10 (milpa de hoy, S0)
	Clima        struct {
		LluviaAnualMM float64 `json:"lluvia_anual_mm"`
		TmediaC       float64 `json:"tmedia_c"`
		TmaxC         float64 `json:"tmax_c"`      // media del mes más cálido
		TminC         float64 `json:"tmin_c"`      // media del mes más frío
		MesesSecos    int     `json:"meses_secos"` // lluvia < ½ ET0
		Resumen       string  `json:"resumen"`
		ResumenEN     string  `json:"resumen_en"`
	} `json:"clima"`
	Bioma string `json:"bioma"` // tropical-humedo | corredor-seco | altiplano | templado | arido | sabana
	Suelo struct {
		Arena   float64 `json:"arena"`
		Arcilla float64 `json:"arcilla"`
		MO      float64 `json:"mo"`
		Fuente  string  `json:"fuente"`
	} `json:"suelo"`
	Fuentes []string `json:"fuentes"`
	Motor   string   `json:"motor"`
}

// ---------- Ronda 5: fecha de siembra elegida vs recomendada ----------

// SimSiembra compara la fecha de siembra elegida con la recomendada por el motor
// (escenario pronostico, menor probabilidad de pérdida y mejor cosecha P50 dentro de la ventana).
type SimSiembra struct {
	Elegida            string         `json:"elegida"`             // YYYY-MM-DD (si el usuario no eligió = Recomendada)
	Recomendada        string         `json:"recomendada"`         // YYYY-MM-DD
	VentanaIni         string         `json:"ventana_ini"`         // YYYY-MM-DD: primer día evaluado de la temporada
	VentanaFin         string         `json:"ventana_fin"`         // YYYY-MM-DD: último día evaluado
	CosechaElegida     string         `json:"cosecha_elegida"`     // YYYY-MM-DD: madurez por grados-día con la temperatura del lugar
	CosechaRecomendada string         `json:"cosecha_recomendada"` // YYYY-MM-DD
	DiasCicloElegida   int            `json:"dias_ciclo_elegida"`  // días de siembra a cosecha
	DiasCicloRecom     int            `json:"dias_ciclo_recomendada"`
	Recomendable       bool           `json:"recomendable"` // la elegida está cerca de la mejor (mismo riesgo ±5 pts y cosecha ≥ 90 %)
	Veredicto          string         `json:"veredicto"`    // ok | ojo | mala
	Texto              string         `json:"texto"`        // "Si sembrás el 12 may, cosechás el 28 ago…"
	TextoEN            string         `json:"texto_en"`
	Razones            []RazonSiembra `json:"razones"`
	RiesgoPorFecha     []RiesgoFecha  `json:"riesgo_por_fecha"` // cada 7 días en la ventana
	Cultivo            string         `json:"cultivo"`          // cultivo usado para el ciclo (maiz en la milpa)
	GDDCiclo           float64        `json:"gdd_ciclo"`        // grados-día (base 10 °C) a madurez
	Escenarios         bool           `json:"escenarios"`       // true si la fecha cae más allá del pronóstico estacional (son escenarios, no pronóstico)
	Fuentes            []string       `json:"fuentes"`

	// Agregado por granjero6 (15-nov): decisiones para quien siembra.
	CosechaEsperada float64           `json:"cosecha_esperada,omitempty"` // qq/mz: P50 de la fecha elegida en esta temporada
	CosechaNormal   float64           `json:"cosecha_normal,omitempty"`   // qq/mz: P50 de la fecha elegida en todos los años 2001–2025 (un año normal)
	RangoIni        string            `json:"rango_ini,omitempty"`        // YYYY-MM-DD: fechas tan buenas como la recomendada (riesgo ±5 pts, cosecha ≥ 95 %)
	RangoFin        string            `json:"rango_fin,omitempty"`
	UltimoSeguro    string            `json:"ultimo_seguro,omitempty"` // YYYY-MM-DD: última fecha con cosecha P50 ≥ 85 % de la recomendada
	Tarde           *RiesgoFecha      `json:"tarde,omitempty"`         // primera fecha después del último día seguro (para "sembrar el X ≈ −N")
	Canicula        *PeriodoSecoInfo  `json:"canicula,omitempty"`      // período seco climatológico dentro de la temporada (si existe)
}

// PeriodoSecoInfo canícula (Centroamérica) o período seco / dry spell (otros lugares), cruzado con el cultivo.
type PeriodoSecoInfo struct {
	Ini           string  `json:"ini"` // YYYY-MM-DD
	Fin           string  `json:"fin"`
	Dias          int     `json:"dias"`
	MMDia         float64 `json:"mm_dia"`     // lluvia media del período (mm/día)
	RefMMDia      float64 `json:"ref_mm_dia"` // lluvia de los picos que lo rodean (mm/día)
	Centroamerica bool    `json:"centroamerica"`
	Etapa         string  `json:"etapa"`      // etapa del cultivo (fecha elegida): antes | crecimiento | floracion | llenado | despues
	Floracion     string  `json:"floracion"` // YYYY-MM-DD: floración de la fecha elegida
	Fuente        string  `json:"fuente"`
}

// RazonSiembra una razón concreta (con fuente) a favor o en contra de una fecha.
type RazonSiembra struct {
	Codigo    string `json:"codigo"`    // falso_inicio | canicula_floracion | frio_helada | sequia | exceso_cosecha | pronostico_16d | ventana | ciclo
	Severidad string `json:"severidad"` // ok | ojo | mala
	Texto     string `json:"texto"`
	TextoEN   string `json:"texto_en"`
	Fuente    string `json:"fuente"`
}

// RiesgoFecha riesgo de sembrar en una fecha (para graficar).
type RiesgoFecha struct {
	Fecha       string  `json:"fecha"`        // YYYY-MM-DD
	ProbPerdida float64 `json:"prob_perdida"` // 0–1
	CosechaP50  float64 `json:"cosecha_p50"`  // qq/mz
	Cosecha     string  `json:"cosecha"`      // YYYY-MM-DD de cosecha por grados-día
}

// SimRango qué parte de la línea de tiempo se devolvió (Desde/Hasta).
type SimRango struct {
	Desde      string `json:"desde"`
	Hasta      string `json:"hasta"`
	DiaInicial int    `json:"dia_inicial"` // índice del día Desde en la línea completa
	Escenarios bool   `json:"escenarios"`  // el rango cae más allá del pronóstico: son escenarios
	Nota       string `json:"nota"`
	NotaEN     string `json:"nota_en"`
}
