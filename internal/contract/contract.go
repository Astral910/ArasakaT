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
