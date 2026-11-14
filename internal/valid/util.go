package valid

import (
	"math"
	"sort"
)

func sqrt(x float64) float64   { return math.Sqrt(x) }
func round2(x float64) float64 { return math.Round(x*100) / 100 }
func sortInts(v []int)         { sort.Ints(v) }
