package fao56

import (
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Ronda 8: catálogo mundial de cultivos para simular «¿prospera esto aquí?» en cualquier lugar.
// Duraciones de etapa y Kc: FAO-56 tablas 11 y 12 (valores típicos; el motor estira o encoge las etapas con los
// grados-día reales del sitio). Raíz y agotamiento p: FAO-56 tabla 22. Ky por etapa: FAO-33 tabla 23/24, repartido
// en establecimiento/vegetativo/floración/llenado. Tbase/Tref: temperatura base de grados-día y la temperatura a la
// que valen las duraciones FAO. Rendimiento de referencia (kg/ha, sin estrés hídrico, manejo medio): FAOSTAT
// promedios mundiales aproximados. Perennes: un año de producción con Kc casi constante.

// Info: lo que la web necesita para el buscador de cultivos.
type Info struct {
	ID      string   `json:"id"`
	ES      string   `json:"es"`
	EN      string   `json:"en"`
	Grupo   string   `json:"grupo"`
	Perenne bool     `json:"perenne,omitempty"`
	Alias   []string `json:"alias,omitempty"`
}

type entrada struct {
	es, en, grupo string
	alias         []string
	L             [4]int
	kc            [3]float64
	zr            [2]float64
	p             float64
	ky            [4]float64
	tb, tr        float64
	ymKgHa        float64
	ciclo         [2]int
	perenne       bool
}

// qq/mz desde kg/ha: 1 mz = 0.6987 ha; 1 qq = 45.36 kg.
func kgHaAQQMz(kg float64) float64 { return kg * 0.6987 / 45.36 }

var catalogo = map[string]entrada{
	// cereales
	"rice":     {"Arroz", "Rice", "cereal", []string{"arroz", "rice", "paddy"}, [4]int{30, 30, 60, 30}, [3]float64{1.05, 1.20, 0.90}, [2]float64{0.5, 1.0}, 0.20, [4]float64{1.0, 1.0, 1.5, 0.5}, 10, 24, 4600, [2]int{90, 180}, false},
	"wheat":    {"Trigo", "Wheat", "cereal", []string{"trigo", "wheat"}, [4]int{20, 25, 60, 30}, [3]float64{0.30, 1.15, 0.25}, [2]float64{1.0, 1.5}, 0.55, [4]float64{0.2, 0.2, 0.65, 0.55}, 4, 18, 3500, [2]int{90, 240}, false},
	"barley":   {"Cebada", "Barley", "cereal", []string{"cebada", "barley"}, [4]int{15, 25, 50, 30}, [3]float64{0.30, 1.15, 0.25}, [2]float64{1.0, 1.5}, 0.55, [4]float64{0.2, 0.2, 0.6, 0.5}, 4, 18, 3000, [2]int{85, 200}, false},
	"oats":     {"Avena", "Oats", "cereal", []string{"avena", "oats", "oat"}, [4]int{15, 25, 50, 30}, [3]float64{0.30, 1.15, 0.25}, [2]float64{1.0, 1.5}, 0.55, [4]float64{0.2, 0.2, 0.6, 0.5}, 4, 18, 2500, [2]int{85, 200}, false},
	"millet":   {"Mijo", "Millet", "cereal", []string{"mijo", "millet", "pearl millet"}, [4]int{15, 25, 40, 25}, [3]float64{0.30, 1.00, 0.30}, [2]float64{1.0, 2.0}, 0.55, [4]float64{0.2, 0.2, 0.6, 0.4}, 10, 26, 1500, [2]int{70, 130}, false},
	"quinoa":   {"Quinoa", "Quinoa", "cereal", []string{"quinua", "quinoa"}, [4]int{25, 60, 60, 35}, [3]float64{0.50, 1.00, 0.70}, [2]float64{0.6, 1.0}, 0.60, [4]float64{0.2, 0.3, 0.7, 0.4}, 3, 16, 1500, [2]int{90, 200}, false},
	"amaranth": {"Amaranto", "Amaranth", "cereal", []string{"amaranto", "bledo", "amaranth"}, [4]int{20, 30, 40, 20}, [3]float64{0.40, 1.05, 0.60}, [2]float64{0.6, 1.0}, 0.55, [4]float64{0.2, 0.3, 0.7, 0.4}, 10, 24, 1500, [2]int{80, 140}, false},
	// leguminosas
	"soybean":  {"Soya", "Soybean", "leguminosa", []string{"soya", "soja", "soybean", "soy"}, [4]int{20, 30, 60, 25}, [3]float64{0.40, 1.15, 0.50}, [2]float64{0.6, 1.3}, 0.50, [4]float64{0.2, 0.2, 0.8, 1.0}, 10, 24, 2800, [2]int{80, 150}, false},
	"peanut":   {"Maní", "Peanut", "leguminosa", []string{"mani", "cacahuate", "cacahuete", "peanut", "groundnut"}, [4]int{25, 35, 45, 25}, [3]float64{0.40, 1.15, 0.60}, [2]float64{0.5, 1.0}, 0.50, [4]float64{0.2, 0.2, 0.8, 0.6}, 10, 25, 1700, [2]int{90, 160}, false},
	"chickpea": {"Garbanzo", "Chickpea", "leguminosa", []string{"garbanzo", "chickpea"}, [4]int{20, 30, 40, 20}, [3]float64{0.40, 1.00, 0.35}, [2]float64{0.6, 1.0}, 0.50, [4]float64{0.2, 0.3, 0.9, 0.5}, 4, 18, 1000, [2]int{80, 160}, false},
	"lentil":   {"Lenteja", "Lentil", "leguminosa", []string{"lenteja", "lentil"}, [4]int{20, 30, 60, 40}, [3]float64{0.40, 1.10, 0.30}, [2]float64{0.6, 0.8}, 0.50, [4]float64{0.2, 0.3, 0.9, 0.5}, 4, 18, 1200, [2]int{90, 180}, false},
	"pea":      {"Arveja", "Pea", "leguminosa", []string{"arveja", "chicharo", "guisante", "pea", "peas"}, [4]int{20, 30, 35, 15}, [3]float64{0.50, 1.15, 0.30}, [2]float64{0.6, 1.0}, 0.35, [4]float64{0.2, 0.3, 0.9, 0.6}, 4, 18, 2000, [2]int{70, 140}, false},
	"cowpea":   {"Caupí", "Cowpea", "leguminosa", []string{"caupi", "frijol de vaca", "cowpea", "black-eyed pea"}, [4]int{20, 30, 30, 20}, [3]float64{0.40, 1.05, 0.35}, [2]float64{0.6, 1.0}, 0.45, [4]float64{0.2, 0.2, 0.9, 0.5}, 10, 26, 1000, [2]int{60, 120}, false},
	"fava":     {"Haba", "Faba bean", "leguminosa", []string{"haba", "habas", "fava", "faba", "broad bean"}, [4]int{20, 30, 35, 15}, [3]float64{0.50, 1.15, 0.30}, [2]float64{0.5, 0.7}, 0.45, [4]float64{0.2, 0.3, 0.9, 0.5}, 4, 18, 2000, [2]int{90, 180}, false},
	// raíces y tubérculos
	"potato":      {"Papa", "Potato", "raíz/tubérculo", []string{"papa", "patata", "potato"}, [4]int{25, 30, 45, 30}, [3]float64{0.50, 1.15, 0.75}, [2]float64{0.4, 0.6}, 0.35, [4]float64{0.45, 0.8, 0.8, 0.3}, 4, 18, 21000, [2]int{90, 180}, false},
	"sweetpotato": {"Camote", "Sweet potato", "raíz/tubérculo", []string{"camote", "batata", "boniato", "sweet potato"}, [4]int{20, 30, 60, 40}, [3]float64{0.50, 1.15, 0.65}, [2]float64{1.0, 1.5}, 0.65, [4]float64{0.4, 0.4, 0.6, 0.4}, 10, 25, 12000, [2]int{100, 180}, false},
	"cassava":     {"Yuca", "Cassava", "raíz/tubérculo", []string{"yuca", "mandioca", "cassava", "manioc"}, [4]int{30, 60, 120, 60}, [3]float64{0.30, 0.80, 0.30}, [2]float64{0.5, 0.8}, 0.35, [4]float64{0.3, 0.3, 0.4, 0.3}, 12, 27, 11000, [2]int{240, 365}, false},
	"carrot":      {"Zanahoria", "Carrot", "hortaliza", []string{"zanahoria", "carrot"}, [4]int{20, 30, 40, 20}, [3]float64{0.70, 1.05, 0.95}, [2]float64{0.5, 1.0}, 0.35, [4]float64{0.5, 0.5, 0.8, 0.6}, 4, 18, 25000, [2]int{70, 150}, false},
	"onion":       {"Cebolla", "Onion", "hortaliza", []string{"cebolla", "onion"}, [4]int{15, 25, 70, 40}, [3]float64{0.70, 1.05, 0.75}, [2]float64{0.3, 0.6}, 0.30, [4]float64{0.45, 0.45, 0.8, 0.3}, 6, 20, 20000, [2]int{100, 180}, false},
	"garlic":      {"Ajo", "Garlic", "hortaliza", []string{"ajo", "garlic"}, [4]int{30, 30, 60, 30}, [3]float64{0.70, 1.00, 0.70}, [2]float64{0.3, 0.5}, 0.30, [4]float64{0.45, 0.45, 0.8, 0.3}, 4, 18, 8000, [2]int{120, 210}, false},
	"beet":        {"Remolacha", "Beetroot", "hortaliza", []string{"remolacha", "betabel", "beet", "beetroot"}, [4]int{15, 25, 20, 10}, [3]float64{0.50, 1.05, 0.95}, [2]float64{0.6, 1.0}, 0.50, [4]float64{0.4, 0.5, 0.8, 0.6}, 4, 18, 25000, [2]int{55, 110}, false},
	// hortalizas
	"tomato":     {"Tomate", "Tomato", "hortaliza", []string{"tomate", "jitomate", "tomato"}, [4]int{30, 40, 40, 25}, [3]float64{0.60, 1.15, 0.80}, [2]float64{0.7, 1.5}, 0.40, [4]float64{0.5, 0.6, 1.1, 0.8}, 10, 24, 35000, [2]int{90, 210}, false},
	"chili":      {"Chile", "Chili pepper", "hortaliza", []string{"chile", "aji", "pimiento", "chili", "pepper", "jalapeno"}, [4]int{30, 35, 40, 20}, [3]float64{0.60, 1.05, 0.90}, [2]float64{0.5, 1.0}, 0.30, [4]float64{0.6, 0.8, 1.2, 1.0}, 10, 24, 15000, [2]int{90, 180}, false},
	"cabbage":    {"Repollo", "Cabbage", "hortaliza", []string{"repollo", "col", "cabbage"}, [4]int{40, 60, 50, 15}, [3]float64{0.70, 1.05, 0.95}, [2]float64{0.5, 0.8}, 0.45, [4]float64{0.2, 0.5, 1.0, 0.7}, 4, 18, 30000, [2]int{80, 180}, false},
	"lettuce":    {"Lechuga", "Lettuce", "hortaliza", []string{"lechuga", "lettuce"}, [4]int{20, 30, 15, 10}, [3]float64{0.70, 1.00, 0.95}, [2]float64{0.3, 0.5}, 0.30, [4]float64{0.6, 0.8, 1.0, 0.8}, 4, 18, 22000, [2]int{45, 100}, false},
	"broccoli":   {"Brócoli", "Broccoli", "hortaliza", []string{"brocoli", "broccoli", "coliflor", "cauliflower"}, [4]int{35, 45, 40, 15}, [3]float64{0.70, 1.05, 0.95}, [2]float64{0.4, 0.6}, 0.45, [4]float64{0.2, 0.5, 1.0, 0.7}, 4, 18, 15000, [2]int{80, 160}, false},
	"spinach":    {"Espinaca", "Spinach", "hortaliza", []string{"espinaca", "spinach", "acelga"}, [4]int{20, 20, 15, 5}, [3]float64{0.70, 1.00, 0.95}, [2]float64{0.3, 0.5}, 0.20, [4]float64{0.6, 0.8, 1.0, 0.8}, 4, 18, 15000, [2]int{40, 90}, false},
	"cucumber":   {"Pepino", "Cucumber", "hortaliza", []string{"pepino", "cucumber"}, [4]int{20, 30, 40, 15}, [3]float64{0.60, 1.00, 0.75}, [2]float64{0.7, 1.2}, 0.50, [4]float64{0.5, 0.5, 1.0, 0.6}, 12, 26, 25000, [2]int{60, 120}, false},
	"squash":     {"Ayote / calabaza", "Squash / pumpkin", "hortaliza", []string{"ayote", "calabaza", "zapallo", "pipian", "guicoy", "squash", "pumpkin", "zucchini"}, [4]int{20, 30, 30, 20}, [3]float64{0.50, 1.00, 0.80}, [2]float64{1.0, 1.5}, 0.35, [4]float64{0.5, 0.5, 1.0, 0.6}, 10, 24, 18000, [2]int{70, 140}, false},
	"watermelon": {"Sandía", "Watermelon", "hortaliza", []string{"sandia", "patilla", "watermelon"}, [4]int{20, 30, 30, 30}, [3]float64{0.40, 1.00, 0.75}, [2]float64{0.8, 1.5}, 0.40, [4]float64{0.45, 0.7, 0.8, 0.4}, 12, 26, 30000, [2]int{80, 140}, false},
	"melon":      {"Melón", "Melon", "hortaliza", []string{"melon", "cantaloupe"}, [4]int{25, 35, 40, 20}, [3]float64{0.50, 0.85, 0.60}, [2]float64{0.8, 1.5}, 0.40, [4]float64{0.45, 0.7, 0.8, 0.4}, 12, 26, 25000, [2]int{80, 140}, false},
	"eggplant":   {"Berenjena", "Eggplant", "hortaliza", []string{"berenjena", "eggplant", "aubergine"}, [4]int{30, 40, 40, 20}, [3]float64{0.60, 1.05, 0.90}, [2]float64{0.7, 1.2}, 0.45, [4]float64{0.5, 0.6, 1.1, 0.8}, 10, 25, 25000, [2]int{100, 180}, false},
	"strawberry": {"Fresa", "Strawberry", "fruta", []string{"fresa", "frutilla", "strawberry"}, [4]int{20, 30, 60, 30}, [3]float64{0.40, 0.85, 0.75}, [2]float64{0.2, 0.3}, 0.20, [4]float64{0.4, 0.6, 1.0, 0.8}, 5, 18, 25000, [2]int{100, 200}, false},
	// industriales
	"cotton":    {"Algodón", "Cotton", "industrial", []string{"algodon", "cotton"}, [4]int{30, 50, 60, 55}, [3]float64{0.35, 1.18, 0.60}, [2]float64{1.0, 1.7}, 0.65, [4]float64{0.2, 0.5, 0.5, 0.25}, 12, 27, 2300, [2]int{140, 210}, false},
	"sunflower": {"Girasol", "Sunflower", "industrial", []string{"girasol", "sunflower"}, [4]int{25, 35, 45, 25}, [3]float64{0.35, 1.10, 0.35}, [2]float64{0.8, 1.5}, 0.45, [4]float64{0.25, 0.5, 1.0, 0.8}, 6, 22, 1800, [2]int{90, 150}, false},
	"sugarcane": {"Caña de azúcar", "Sugarcane", "industrial", []string{"cana", "cana de azucar", "sugarcane", "sugar cane"}, [4]int{35, 60, 180, 90}, [3]float64{0.40, 1.25, 0.75}, [2]float64{1.2, 2.0}, 0.65, [4]float64{0.75, 0.75, 0.5, 0.1}, 12, 27, 70000, [2]int{270, 365}, false},
	"tobacco":   {"Tabaco", "Tobacco", "industrial", []string{"tabaco", "tobacco"}, [4]int{10, 20, 30, 30}, [3]float64{0.50, 1.10, 0.80}, [2]float64{0.5, 1.0}, 0.50, [4]float64{0.2, 1.0, 0.5, 0.4}, 10, 24, 2000, [2]int{80, 140}, false},
	"sesame":    {"Ajonjolí", "Sesame", "industrial", []string{"ajonjoli", "sesamo", "sesame"}, [4]int{20, 30, 40, 20}, [3]float64{0.35, 1.10, 0.25}, [2]float64{1.0, 1.5}, 0.60, [4]float64{0.2, 0.3, 0.8, 0.5}, 12, 27, 700, [2]int{80, 140}, false},
	"canola":    {"Canola / colza", "Canola / rapeseed", "industrial", []string{"canola", "colza", "rapeseed"}, [4]int{25, 35, 45, 25}, [3]float64{0.35, 1.10, 0.35}, [2]float64{1.0, 1.5}, 0.60, [4]float64{0.2, 0.3, 0.8, 0.5}, 4, 18, 2000, [2]int{100, 240}, false},
	// perennes (un año de producción)
	"coffee":    {"Café", "Coffee", "perenne", []string{"cafe", "coffee"}, [4]int{60, 60, 180, 65}, [3]float64{0.90, 0.95, 0.95}, [2]float64{0.9, 1.5}, 0.40, [4]float64{0.4, 0.5, 1.0, 0.6}, 10, 21, 900, [2]int{300, 365}, true},
	"banana":    {"Banano / plátano", "Banana / plantain", "perenne", []string{"banano", "platano", "guineo", "banana", "plantain"}, [4]int{60, 90, 120, 95}, [3]float64{0.50, 1.10, 1.00}, [2]float64{0.5, 0.9}, 0.35, [4]float64{0.8, 1.2, 1.3, 1.0}, 14, 27, 20000, [2]int{300, 365}, true},
	"cacao":     {"Cacao", "Cocoa", "perenne", []string{"cacao", "cocoa"}, [4]int{60, 60, 180, 65}, [3]float64{1.00, 1.05, 1.05}, [2]float64{0.7, 1.0}, 0.30, [4]float64{0.4, 0.5, 1.0, 0.6}, 15, 26, 500, [2]int{300, 365}, true},
	"avocado":   {"Aguacate", "Avocado", "perenne", []string{"aguacate", "palta", "avocado"}, [4]int{60, 90, 120, 95}, [3]float64{0.60, 0.85, 0.75}, [2]float64{0.5, 1.0}, 0.70, [4]float64{0.4, 0.5, 1.0, 0.6}, 10, 22, 10000, [2]int{300, 365}, true},
	"citrus":    {"Cítricos (naranja, limón)", "Citrus (orange, lemon)", "perenne", []string{"naranja", "limon", "lima", "mandarina", "citricos", "orange", "lemon", "lime", "citrus"}, [4]int{60, 90, 120, 95}, [3]float64{0.70, 0.65, 0.70}, [2]float64{1.1, 1.5}, 0.50, [4]float64{0.4, 0.6, 1.1, 0.7}, 12, 24, 15000, [2]int{300, 365}, true},
	"mango":     {"Mango", "Mango", "perenne", []string{"mango"}, [4]int{60, 90, 120, 95}, [3]float64{0.60, 0.85, 0.75}, [2]float64{1.0, 2.0}, 0.60, [4]float64{0.4, 0.5, 1.0, 0.6}, 12, 26, 9000, [2]int{300, 365}, true},
	"pineapple": {"Piña", "Pineapple", "perenne", []string{"pina", "anana", "pineapple"}, [4]int{60, 90, 180, 35}, [3]float64{0.50, 0.30, 0.30}, [2]float64{0.3, 0.6}, 0.50, [4]float64{0.3, 0.4, 0.5, 0.3}, 12, 26, 40000, [2]int{300, 365}, true},
	"papaya":    {"Papaya", "Papaya", "perenne", []string{"papaya", "lechosa", "fruta bomba"}, [4]int{60, 90, 120, 95}, [3]float64{0.60, 1.00, 0.90}, [2]float64{0.5, 1.0}, 0.35, [4]float64{0.5, 0.8, 1.1, 0.8}, 15, 26, 30000, [2]int{300, 365}, true},
	"grape":     {"Uva (vid)", "Grape", "perenne", []string{"uva", "vid", "vina", "grape", "vine"}, [4]int{20, 40, 120, 60}, [3]float64{0.30, 0.85, 0.45}, [2]float64{1.0, 2.0}, 0.45, [4]float64{0.4, 0.6, 1.0, 0.6}, 10, 20, 9000, [2]int{150, 300}, true},
	"cardamom":  {"Cardamomo", "Cardamom", "perenne", []string{"cardamomo", "cardamom"}, [4]int{60, 60, 180, 65}, [3]float64{0.90, 1.00, 1.00}, [2]float64{0.4, 0.8}, 0.35, [4]float64{0.4, 0.5, 1.0, 0.6}, 12, 24, 250, [2]int{300, 365}, true},
	"oilpalm":   {"Palma africana", "Oil palm", "perenne", []string{"palma", "palma africana", "palma de aceite", "oil palm"}, [4]int{60, 60, 180, 65}, [3]float64{0.95, 1.00, 1.00}, [2]float64{0.7, 1.1}, 0.65, [4]float64{0.4, 0.5, 1.0, 0.6}, 15, 27, 15000, [2]int{300, 365}, true},
	"olive":     {"Olivo", "Olive", "perenne", []string{"olivo", "aceituna", "olive"}, [4]int{30, 90, 60, 90}, [3]float64{0.65, 0.70, 0.70}, [2]float64{1.2, 1.7}, 0.65, [4]float64{0.4, 0.5, 1.0, 0.6}, 7, 20, 2500, [2]int{240, 365}, true},
	"tea":       {"Té", "Tea", "perenne", []string{"te", "tea"}, [4]int{60, 60, 180, 65}, [3]float64{0.95, 1.00, 1.00}, [2]float64{0.9, 1.5}, 0.40, [4]float64{0.4, 0.5, 1.0, 0.6}, 12, 22, 2000, [2]int{300, 365}, true},
	"coconut":   {"Coco (cocotero)", "Coconut", "perenne", []string{"coco", "cocotero", "palma de coco", "coconut"}, [4]int{60, 60, 180, 65}, [3]float64{0.95, 1.00, 1.00}, [2]float64{0.7, 1.1}, 0.65, [4]float64{0.4, 0.5, 1.0, 0.6}, 15, 27, 8000, [2]int{300, 365}, true},
	"apple":     {"Manzana", "Apple", "perenne", []string{"manzana", "manzano", "apple"}, [4]int{20, 70, 90, 30}, [3]float64{0.45, 0.95, 0.70}, [2]float64{1.0, 2.0}, 0.50, [4]float64{0.4, 0.5, 1.0, 0.6}, 6, 18, 20000, [2]int{150, 240}, true},
}

func init() {
	for id, e := range catalogo {
		if _, ya := Crops[id]; ya {
			continue
		}
		Crops[id] = Crop{
			ID: id, Name: e.es, L: e.L, Kc: e.kc, ZrMin: e.zr[0], ZrMax: e.zr[1], P: e.p, Ky: e.ky,
			YmQQMz: kgHaAQQMz(e.ymKgHa), Tbase: e.tb, Tref: e.tr, CicloMin: e.ciclo[0], CicloMax: e.ciclo[1], Perenne: e.perenne,
			YmNote: "rendimiento de referencia ≈ promedio mundial FAOSTAT sin estrés hídrico (aproximado)",
		}
	}
}

// Nombre del cultivo del catálogo (o "" si no está).
func Nombre(id string, en bool) string {
	e, ok := catalogo[id]
	if !ok {
		return ""
	}
	if en {
		return e.en
	}
	return e.es
}

// Lista: los cultivos de siempre (milpa, maíz, frijol, sorgo) primero y después el catálogo en orden alfabético.
func Lista() []Info {
	out := []Info{
		{ID: "milpa", ES: "Milpa (maíz + frijol)", EN: "Milpa (maize + beans)", Grupo: "cereal", Alias: []string{"milpa"}},
		{ID: "maiz", ES: "Maíz", EN: "Maize / corn", Grupo: "cereal", Alias: []string{"maiz", "elote", "corn", "maize"}},
		{ID: "frijol", ES: "Frijol", EN: "Beans", Grupo: "leguminosa", Alias: []string{"frijol", "frejol", "poroto", "judia", "bean", "beans"}},
		{ID: "sorgo", ES: "Sorgo (maicillo)", EN: "Sorghum", Grupo: "cereal", Alias: []string{"sorgo", "maicillo", "sorghum"}},
	}
	resto := make([]Info, 0, len(catalogo))
	for id, e := range catalogo {
		resto = append(resto, Info{ID: id, ES: e.es, EN: e.en, Grupo: e.grupo, Perenne: e.perenne, Alias: e.alias})
	}
	sort.Slice(resto, func(i, j int) bool { return resto[i].ES < resto[j].ES })
	return append(out, resto...)
}

// Buscar el id del catálogo para lo que escribió el agricultor ("Papa", "sweet potato", "rice"…); "" si no hay.
func Buscar(s string) string {
	q := simple(s)
	if q == "" {
		return ""
	}
	if _, ok := catalogo[q]; ok {
		return q
	}
	for id, e := range catalogo {
		if simple(e.es) == q || simple(e.en) == q {
			return id
		}
		for _, a := range e.alias {
			if simple(a) == q {
				return id
			}
		}
	}
	return ""
}

func simple(s string) string {
	t := norm.NFD.String(strings.ToLower(strings.TrimSpace(s)))
	var b strings.Builder
	for _, r := range t {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
