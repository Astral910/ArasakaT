// Abrigo meteorológico de platos (tipo Stevenson / Gill) para el SHT31: platos cónicos apilados que
// dan sombra y dejan pasar el aire; el sensor queda en el centro sin sol directo ni lluvia.
// Se arma con 3 varillas roscadas M3 y separadores integrados. Blanco o gris claro (refleja el sol).
// Impresión: cada plato boca abajo (el ala en la cama) sin soportes; techo igual; base con la cuna.
include <comun.scad>

plato_d = 120; hueco_d = 60; plato_t = 2.0; caida = 10; sep = 14; n_platos = 6;
varilla_r = 48;  // radio de las 3 varillas M3

parte = "plato"; // plato | techo | base | todo

module agujeros_varilla(h = 50) { for (a = [90, 210, 330]) rotate([0, 0, a]) translate([varilla_r, 0, -1]) cylinder(d = m3_paso, h = h); }

R1 = (plato_d - 2 * plato_t * 1.6) / 2;  // radio inferior del cono interior
R2 = (hueco_d + 8) / 2;
function z_bajo(r) = caida * (R1 - r) / (R1 - R2);   // altura de la cara inferior del plato a radio r
poste_h = sep + z_bajo(varilla_r + 4) - z_bajo(varilla_r) - 0.05; // apoya en el punto más bajo de la cara cónica de arriba

module cono_lleno() { cylinder(d1 = plato_d, d2 = hueco_d + 2 * plato_t + 8, h = caida + plato_t); }
module cono_hueco() { translate([0, 0, -0.01]) cylinder(d1 = 2 * R1, d2 = 2 * R2, h = caida); }

// plato: anillo cónico (cae hacia afuera) con 3 postes que sostienen el plato de arriba
module abrigo_plato() {
  difference() {
    union() {
      difference() { cono_lleno(); cono_hueco(); translate([0, 0, -1]) cylinder(d = hueco_d, h = caida + plato_t + 2); }
      for (a = [90, 210, 330]) rotate([0, 0, a]) translate([varilla_r, 0, z_bajo(varilla_r)]) cylinder(d = 8, h = poste_h);
    }
    agujeros_varilla(80);
  }
}
// techo: misma cara inferior que un plato pero cerrado (no entra lluvia ni sol al centro)
module abrigo_techo() {
  difference() {
    union() { cono_lleno(); translate([0, 0, caida]) cylinder(d = hueco_d + 2 * plato_t + 8, h = plato_t + 2); }
    cono_hueco();
    translate([0, 0, caida - 0.02]) cylinder(d = 2 * R2, h = 0.03);
    for (a = [90, 210, 330]) rotate([0, 0, a]) translate([varilla_r, 0, -1]) {
      cylinder(d = m3_paso, h = 40);
      translate([0, 0, z_bajo(varilla_r) + 2]) cylinder(d = 8.4, h = 40); // la tuerca queda adentro del cono
    }
  }
}
// base: plato plano con la cuna del SHT31 (placa típica 15 × 25 mm) colgando al centro, y el brazo a la abrazadera
module abrigo_base() {
  difference() {
    union() {
      difference() { cylinder(d = plato_d, h = plato_t); translate([0, 0, -1]) cylinder(d = hueco_d - 10, h = plato_t + 2); }
      for (a = [90, 210, 330]) rotate([0, 0, a]) translate([varilla_r, 0, 0]) cylinder(d = 8, h = sep + z_bajo(varilla_r + 4) - 0.05);
      // puente central con la cuna del sensor
      translate([-hueco_d / 2 + 4, -5, 0]) cube([hueco_d - 8, 10, plato_t]);
      translate([-10, -4, 0]) difference() { cube([20, 8, 30]); translate([2, 1.6 - tol / 2, 4]) cube([16 + tol, 1.6 + tol, 30]); }
      // brazo radial a la abrazadera del tubo (placa con 2 agujeros M3 a 30 mm)
      translate([plato_d / 2 - 6, -12, 0]) cube([46, 24, 5]);
    }
    agujeros_varilla(60);
    for (x = [plato_d / 2 + 15, plato_d / 2 + 45 - 15]) for (y = [-0]) translate([x, y, -1]) cylinder(d = m3_paso, h = 8);
    translate([0, 0, -1]) cylinder(d = 6, h = 10); // pasa el cable
  }
}

if (parte == "plato") abrigo_plato();
if (parte == "techo") abrigo_techo();
if (parte == "base") abrigo_base();
if (parte == "todo") abrigo_armado();
module abrigo_armado() {
  color("#f4f2ec") abrigo_base();
  for (i = [0 : n_platos - 1]) color("#f4f2ec") translate([0, 0, sep * (i + 1)]) abrigo_plato();
  color("#e6e2d6") translate([0, 0, sep * (n_platos + 1)]) abrigo_techo();
}

// para chequeo.scad
module plato_en(i) translate([0, 0, sep * i]) abrigo_plato();
module techo_en() translate([0, 0, sep * (n_platos + 1)]) abrigo_techo();
