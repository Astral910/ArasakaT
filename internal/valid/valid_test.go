package valid

import "testing"

func TestScore(t *testing.T) {
	r := Score([]YearFlag{{2001, true}, {2009, false}, {2010, true}, {2011, false}})
	if r.Hits != 1 || r.Misses != 1 || r.FalseAlarms != 1 || r.CorrectNeg != 1 || r.Total != 2 || r.HitRate != 0.5 {
		t.Fatalf("%+v", r)
	}
}

func TestCompareNDVI(t *testing.T) {
	nd := map[int]float64{2001: 0.4, 2002: 0.7, 2003: 0.72, 2004: 0.69, 2005: 0.71, 2006: 0.7}
	en := map[int]float64{2001: 0.3, 2002: 1, 2003: 1, 2004: 0.9, 2005: 1, 2006: 0.95}
	r := CompareNDVI(nd, en, map[int]bool{2001: true}, "x")
	if r.LowYears != 1 || r.Agree != 1 || r.DocLow != 1 || r.Correlation < 0.9 {
		t.Fatalf("%+v", r)
	}
}
