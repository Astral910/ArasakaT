package plan

import (
	"strings"
	"testing"

	"fieldshift/internal/global"
)

// i18n6: con idioma "en" la confianza no debe llegar con frases del motor en español.
func TestHabilidadYFuentesEN(t *testing.T) {
	h := HabilidadEN("acertó la temporada en 14 de 25 años (56 % vs 33 % al azar) · pérdida: Brier 0.272 vs 0.250 · detectó 5 de 8 sequías documentadas · Brier IA 0.154 vs estadística 0.161")
	want := "got the season right in 14 of 25 years (56% vs 33% by chance) · loss: Brier 0.272 vs 0.250 · detected 5 of 8 documented droughts · Brier AI 0.154 vs statistics 0.161"
	if h != want {
		t.Fatalf("habilidad EN:\n%s\nquiere:\n%s", h, want)
	}
	for _, f := range []string{global.SrcForecast, global.SrcSeasonal, global.SrcNino34} {
		if en := FuenteEN(f); en == f || strings.Contains(en, "anomalía") || strings.Contains(en, "pronóstico") {
			t.Fatalf("fuente sin traducir: %s", en)
		}
	}
}
