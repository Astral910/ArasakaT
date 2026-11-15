// Soporte del panel solar (6 V, 1–2 W) inclinado y orientado al ecuador (al sur en el hemisferio norte).
// Inclinación: `angulo`. Regla práctica para todo el año: ≈ latitud, nunca menos de 10–15° para que la
// lluvia lo limpie. Guatemala (14–18° N) → 15°. Ajustable de 0 a 45° con la ranura en arco (tornillo M3).
// Partes: bandeja (abraza el panel), 2 orejas laterales con eje M3 y ranura en arco, y la placa a la
// abrazadera del tubo (abrazadera_brazo de abrazadera.scad, 2 agujeros a 30 mm).
// Impresión: bandeja plana sin soportes; orejas de costado sin soportes.
include <comun.scad>

latitud = 14.8;                     // Jocotán
angulo  = max(15, round(abs(latitud)));
panel_l = 136; panel_a = 110; panel_t = 3.0;  // panel típico 6 V 2 W (1 W: 110 × 60)
parte = "bandeja"; // bandeja | oreja | todo
echo(str("inclinacion sugerida para latitud ", latitud, ": ", angulo, " grados"));

bt = 2.4;   // espesor
module bandeja() {
  difference() {
    union() {
      cube([panel_l + 2 * bt + 2 * tol, panel_a + 2 * bt + 2 * tol, bt + panel_t + 1.2]);
      // lengüetas de las orejas (abajo, al centro)
      for (x = [panel_l / 2 - 25, panel_l / 2 + 25 + 2 * bt]) translate([x, panel_a / 2 + bt - 15, -18]) cube([4, 30, 18.01]);
    }
    // alojamiento del panel con 1,2 mm de borde que lo retiene (el panel entra de costado)
    translate([bt, bt, bt]) cube([panel_l + 2 * tol, panel_a + 2 * tol, panel_t + 0.3]);
    translate([bt + 3, bt + 3, bt]) cube([panel_l + 2 * tol - 6, panel_a + 2 * tol - 6, 10]);
    translate([-1, bt, bt]) cube([bt + 2, panel_a + 2 * tol, panel_t + 0.3]);   // entrada lateral
    translate([bt + 15, bt + 15, -1]) cube([panel_l - 30, panel_a - 30, bt + 2]); // ventana (aliviana, ventila)
    for (x = [panel_l / 2 - 25 - 1, panel_l / 2 + 25 + 2 * bt - 1]) translate([x, panel_a / 2 + bt, -10]) rotate([0, 90, 0]) cylinder(d = m3_paso, h = 7);
    translate([panel_l / 2, panel_a + bt, -1]) cylinder(d = 5, h = 10); // cable
  }
}
// oreja: pivote M3 arriba, ranura en arco de 0 a 45° (radio 22) y pie con 2 agujeros a 30 mm
module oreja() {
  rr = 22;
  difference() {
    union() {
      hull() { translate([0, 0, 0]) cylinder(r = 8, h = 4); translate([-25, -rr - 12, 0]) cube([50, 6, 4]); }
      translate([-25, -rr - 12, 0]) cube([50, 6, 16]);
    }
    translate([0, 0, -1]) cylinder(d = m3_paso, h = 6);
    rotate([0, 0, -135]) translate([0, 0, -1]) {  // ranura en arco de 45° (radio rr·0,75) con puntas redondas
      rotate_extrude(angle = 45) translate([rr * 0.75 - m3_paso / 2, 0]) square([m3_paso, 6]);
      for (a = [0, 45]) rotate([0, 0, a]) translate([rr * 0.75, 0, 0]) cylinder(d = m3_paso, h = 6);
    }
    for (x = [-15, 15]) translate([x, -rr - 13, 10]) rotate([-90, 0, 0]) cylinder(d = m3_paso, h = 8);
  }
}
if (parte == "bandeja") bandeja();
if (parte == "oreja") oreja();
if (parte == "todo") {
  color("#e9e4d8") for (y = [0, 1]) translate([0, y * 30, 0]) rotate([90, 0, 0]) oreja();
  color("#1b3a5c") translate([-(panel_l / 2 + bt + 12), -10, 30]) rotate([angulo, 0, 0]) bandeja();
}
