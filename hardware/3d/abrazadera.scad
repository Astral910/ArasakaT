// Estaca y abrazaderas para tubo PVC de ½" (Ø 21,3) o ¾" (Ø 26,7): todo se monta en un tubo vertical.
//  - abrazadera(): dos mitades con 2 tornillos M3 y tuerca cautiva; la mitad "placa" lleva el patrón de
//    la pieza a montar (caja: 60 × 36 con insertos; panel, abrigo y pluviómetro: 2 agujeros a 30 mm).
//  - estaca(): punta en cruz de 200 mm con vaso para el tubo (se clava y el tubo entra con juego).
// Impresión: mitades de canto (el semicírculo hacia arriba), sin soportes; estaca de pie, sin soportes.
include <comun.scad>

parte = "abrazadera_caja"; // abrazadera_caja | abrazadera_brazo | abrazadera_contra | estaca
ab_h = 24;           // alto de la abrazadera
ab_t = 4;            // espesor del aro
td = tubo_d + 2 * tol;
orejas = td / 2 + ab_t + 5;

module medio_aro() {
  difference() {
    union() {
      cylinder(d = td + 2 * ab_t, h = ab_h);
      translate([-orejas - 5, -4.5, 0]) cube([2 * orejas + 10, 4, ab_h]);  // orejas (1 mm de luz entre mitades: aprietan el tubo)
    }
    translate([0, 0, -1]) cylinder(d = td, h = ab_h + 2);
    translate([-50, -0.5, -1]) cube([100, 50, ab_h + 2]);                 // queda la mitad y < −0,5
    for (s = [-1, 1]) translate([s * (orejas), 1, ab_h / 2]) rotate([90, 0, 0]) cylinder(d = m3_paso, h = 10);
  }
}
// contra: con alojamiento hexagonal para la tuerca M3
module contra() {
  difference() {
    mirror([0, 1, 0]) medio_aro();
    for (s = [-1, 1]) translate([s * orejas, 4.5 - 2.5, ab_h / 2]) rotate([-90, 0, 0]) cylinder(d = m3_tuerca / cos(30), h = 3, $fn = 6);
  }
}
// mitad con placa
module con_placa(tipo) {
  ancho = tipo == "caja" ? 80 : 50;
  alto = tipo == "caja" ? 52 : ab_h;
  difference() {
    union() {
      medio_aro();
      translate([-ancho / 2, -td / 2 - ab_t - 5, 0]) cube([ancho, 5, alto]);
    }
    translate([0, 0, -1]) cylinder(d = td, h = alto + 2);
    if (tipo == "caja")
      for (x = [-30, 30], z = [8, 44]) translate([x, -td / 2 - ab_t - 6, z]) rotate([-90, 0, 0]) {
        cylinder(d = m3_paso, h = 8); cylinder(d = m3_cab, h = 2.2);
      }
    else
      for (x = [-15, 15]) translate([x, -td / 2 - ab_t - 6, ab_h / 2]) rotate([-90, 0, 0]) cylinder(d = m3_paso, h = 8);
  }
}
module estaca() {
  largo = 200; vaso_h = 50;
  // punta en cruz
  for (a = [0, 90]) rotate([0, 0, a]) hull() {
    translate([-(td + 6) / 2, -2, largo - 1]) cube([td + 6, 4, 1]);
    translate([-1, -2, 0]) cube([2, 4, 1]);
  }
  translate([0, 0, largo]) difference() {
    cylinder(d = td + 8, h = vaso_h);
    translate([0, 0, 3]) cylinder(d = td, h = vaso_h);
    translate([0, 0, vaso_h - 15]) rotate([0, 90, 0]) cylinder(d = m3_paso, h = 40, center = true); // pasador M3
  }
}

if (parte == "abrazadera_caja") con_placa("caja");
if (parte == "abrazadera_brazo") con_placa("brazo");
if (parte == "abrazadera_contra") contra();
if (parte == "estaca") estaca();

// para chequeo.scad
module tubo() translate([0, 0, -50]) cylinder(d = tubo_d, h = 400);
module tubo_en_estaca() translate([0, 0, 203]) cylinder(d = tubo_d, h = 200);
