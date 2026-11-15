// FieldShift · estación de campo · parámetros comunes (mm)
// Material: PETG o ASA (no PLA: se deforma al sol arriba de ~55 °C). Boquilla 0,4 mm, capas 0,2 mm.
$fn = 64;
tol      = 0.25;   // juego entre piezas que encastran (0,2–0,3 mm)
tol_eje  = 0.30;   // juego del eje del balancín (clavo o varilla de 2 mm)
pared    = 3.0;    // pared exterior (7–8 perímetros con 0,4 mm: estanca)
// inserto roscado M3 a calor (M3×5,7, Ø ext 4,6): agujero 4,0 × 6
ins_d = 4.0;  ins_h = 6.0;
m3_paso = 3.4;     // agujero pasante M3
m3_cab  = 6.2;     // cabeza M3 (avellanado plano)
m3_tuerca = 5.5 + 0.3; // tuerca M3 entre caras + juego
pg7_d   = 12.7;    // prensaestopas PG7: rosca 12,5 mm + juego
// tubo PVC: ½" SCH40 = 21,3 mm de diámetro exterior; ¾" = 26,7 mm
tubo_d  = 21.3;

module redondeado(l, a, h, r) {
  // prisma de l × a × h con esquinas verticales redondeadas de radio r
  hull() for (x = [r, l - r], y = [r, a - r]) translate([x, y, 0]) cylinder(r = r, h = h);
}
module inserto() { translate([0, 0, -0.01]) cylinder(d = ins_d, h = ins_h + 0.01); }
