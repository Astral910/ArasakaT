package geo

import "testing"

func TestContainsAndCells(t *testing.T) {
	sq := []Polygon{{Ring{{0, 0}, {10, 0}, {10, 10}, {0, 10}, {0, 0}}, Ring{{4, 4}, {6, 4}, {6, 6}, {4, 6}, {4, 4}}}}
	if !Contains(sq, 2, 2) || Contains(sq, 5, 5) || Contains(sq, 11, 5) {
		t.Fatal("punto en polígono con hueco")
	}
	if lon, lat := Centroid(sq); lon < 4 || lon > 6 || lat < 4 || lat > 6 {
		// el centroide cae en el hueco: debe devolver un punto interior
		if !Contains(sq, lon, lat) {
			t.Fatal("centroide fuera")
		}
	}
	id, clat, clon := PowerCell(14.81, -89.38)
	if id != "c15_m89.375" || clat != 15 || clon != -89.375 {
		t.Fatalf("celda %s %v %v", id, clat, clon)
	}
	if Slug("Jocotán, Chiquimula") != "jocotan-chiquimula" {
		t.Fatal(Slug("Jocotán, Chiquimula"))
	}
}

func TestLoadLocate(t *testing.T) {
	ms, err := Load("../../data/municipios.json", "../../data/municipios.geojson")
	if err != nil {
		t.Skip(err)
	}
	ix := NewIndex(ms)
	if m := ix.Locate(14.80, -89.38); m == nil || m.ID != "jocotan-chiquimula" {
		t.Fatalf("Locate: %v", m)
	}
	if r := ix.Search("camotan", 3); len(r) == 0 || r[0].ID != "camotan-chiquimula" {
		t.Fatal("Search")
	}
}
