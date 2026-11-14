package valid

import "testing"

func TestScore(t *testing.T) {
	r := Score([]YearFlag{{2001, true}, {2009, false}, {2010, true}, {2011, false}})
	if r.Hits != 1 || r.Misses != 1 || r.FalseAlarms != 1 || r.CorrectNeg != 1 || r.Total != 2 || r.HitRate != 0.5 {
		t.Fatalf("%+v", r)
	}
}
