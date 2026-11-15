// Pluviómetro de balancín impreso.
// Embudo de 100,0 mm de diámetro de boca (área 7 854 mm²) con borde en filo; balancín de dos cubetas
// sobre un eje de clavo o varilla de 2 mm; imán de neodimio de 6×3 mm en el brazo central que pasa
// frente a un reed (ampolla de vidrio 2×14 mm o módulo) alojado en la base.
//
// mm por golpe = volumen por golpe (mm³) / 7 854 mm². Diseño: 1,57 mL → 0,20 mm/golpe.
// El volumen real depende de la altura de los topes (tornillos M3 regulables): se calibra vertiendo
// 157 mL despacio con jeringa (= 20 mm de lluvia) y contando golpes: mm_golpe = 20 / golpes.
// Impresión: embudo boca abajo (borde de filo en la cama) sin soportes; base sin soportes;
// balancín de costado (las cubetas abiertas hacia arriba) sin soportes. PETG/ASA, 3 perímetros, 25 %.
include <comun.scad>

boca_d   = 100.0;  // diámetro de captación (exacto: de él sale el área)
collar_h = 45;     // pared vertical sobre la boca: evita que la lluvia salpique afuera
embudo_h = 45;
salida_d = 4;
base_d   = 112;    // tubo de la base
base_h   = 85;
falda    = 12;     // el embudo encastra por fuera de la base
eje_d    = 2.0;    // clavo o varilla
// balancín
b_largo  = 56;     // de punta a punta
b_prof   = 24;     // a lo largo del eje (interior de cubeta = b_prof − 2·1,6)
b_alto   = 16;
b_pared  = 1.6;
iman_d   = 6.0; iman_h = 3.0;
brazo    = 25;     // largo del brazo del imán bajo el piso de las cubetas
eje_b    = -2.5;   // el eje pasa 2,5 mm debajo del piso (el balancín queda estable sobre un tope)

parte = "embudo"; // embudo | base | balancin | todo

area = PI * pow(boca_d / 2, 2);
echo(str("area de captacion = ", area, " mm2; 1,571 mL por golpe = ", 1571 / area, " mm"));

module pluv_embudo() {
  difference() {
    union() {
      // collar con borde en filo arriba
      translate([0, 0, embudo_h]) difference() {
        cylinder(d = boca_d + 2 * 2.0, h = collar_h);
        translate([0, 0, -1]) cylinder(d = boca_d, h = collar_h + 2);
        translate([0, 0, collar_h - 4]) difference() { // chaflán exterior → filo
          cylinder(d = boca_d + 10, h = 5);
          cylinder(d1 = boca_d + 4, d2 = boca_d + 0.4, h = 4);
        }
      }
      // cono
      cylinder(d1 = salida_d + 4, d2 = boca_d + 4, h = embudo_h);
      // falda que encastra sobre la base
      translate([0, 0, embudo_h - 25]) difference() {
        cylinder(d = base_d + 2 * tol + 2 * 2.4, h = falda + 25);
        translate([0, 0, -1]) cylinder(d = base_d + 2 * tol, h = falda + 1);
        translate([0, 0, falda - 0.01]) cylinder(d1 = base_d + 2 * tol, d2 = boca_d - 6, h = 25.02);
      }
    }
    translate([0, 0, -0.01]) cylinder(d1 = salida_d, d2 = boca_d, h = embudo_h + 0.02);
    translate([0, 0, -1]) cylinder(d = salida_d, h = 5);
  }
  // rejilla contra hojas (anillo con 3 rayos), apoyada en el cono
  translate([0, 0, embudo_h * 0.55]) for (a = [0, 60, 120]) rotate([0, 0, a])
    translate([-(boca_d * 0.55) / 2, -0.8, 0]) cube([boca_d * 0.55, 1.6, 1.6]);
}

// cubetas: piso + pared central + dos laterales triangulares; cada cubeta queda abierta por la cara en
// pendiente (por ahí se vacía al volcar). El agua se junta en el rincón entre el piso y la pared central.
module perfil() polygon([[-b_largo / 2, 0], [b_largo / 2, 0], [b_largo / 2, 3], [0, b_alto], [-b_largo / 2, 3]]);
module pluv_balancin() {
  difference() {
    union() {
      translate([-b_largo / 2, -b_prof / 2, 0]) cube([b_largo, b_prof, b_pared]);                 // piso
      translate([-b_pared / 2, -b_prof / 2, 0]) cube([b_pared, b_prof, b_alto]);                  // pared central
      for (y = [-b_prof / 2, b_prof / 2 - b_pared])                                               // laterales
        translate([0, y + b_pared, 0]) rotate([90, 0, 0]) linear_extrude(b_pared) perfil();
      // mangas del eje (debajo del piso, al centro)
      rotate([90, 0, 0]) translate([0, eje_b, -b_prof / 2 - 2]) cylinder(d = 7, h = b_prof + 4);
      // brazo del imán: cuelga 25 mm bajo el centro; al volcar barre ±8 mm frente al reed
      translate([-4, -3, -brazo]) cube([8, 6, brazo + 1]);
    }
    // eje: Ø 2,0 + juego
    rotate([90, 0, 0]) translate([0, eje_b, -b_prof]) cylinder(d = eje_d + tol_eje, h = 2 * b_prof);
    // alojamiento del imán, en la punta del brazo mirando al piso (al reed)
    translate([0, 0, -brazo - 0.01]) cylinder(d = iman_d + 0.2, h = iman_h + 0.2);
  }
}
// volumen interior de una cubeta hasta el borde (referencia; el golpe ocurre antes)
cub_area = 0.5 * (b_largo / 2 - b_pared / 2) * (b_alto - b_pared);
echo(str("cubeta llena hasta el borde ~ ", cub_area * (b_prof - 2 * b_pared) / 1000, " mL"));

eje_z = 30;   // altura del eje sobre el piso de la base
py = b_prof / 2 + 2 + 0.6;   // cara interior de los postes: 0,6 mm de juego con las mangas
tope_h = 12;  // columnas de los topes (+ tornillo M3 regulable que sobresale 3–8 mm)
module pluv_base() {
  difference() {
    union() {
      difference() {
        cylinder(d = base_d, h = base_h);
        translate([0, 0, 3]) cylinder(d = base_d - 2 * pared, h = base_h);
      }
      // dos postes del eje (agujero Ø 1,9: el clavo entra a presión en los postes y gira libre en el balancín)
      for (y = [py, -py - 5]) translate([-5, y, 0]) difference() {
        cube([10, 5, eje_z + 6]);
        translate([5, -1, eje_z]) rotate([-90, 0, 0]) cylinder(d = 1.9, h = 7);
      }
      // topes regulables: columnas con inserto M3 (la cabeza del tornillo es el tope)
      for (s = [-1, 1]) translate([s * 22, 0, 0]) difference() {
        cylinder(d = 8, h = tope_h);
        translate([0, 0, tope_h - ins_h]) inserto();
      }
      // bloque del reed bajo el brazo del imán
      translate([-6, -9, 0]) cube([12, 18, 6]);
    }
    // canal del reed (ampolla 2×14 mm a lo largo del eje), abierto arriba: se calza con cinta para regular la altura
    translate([-1.4, -8, 3]) cube([2.8, 16, 4]);
    // salida del cable del reed por el piso
    translate([0, 7, -1]) cylinder(d = 3.2, h = 6);
    translate([0, -7, -1]) cylinder(d = 3.2, h = 6);
    // desagües (el agua medida cae y sale), protegidos por malla si hay insectos
    for (a = [45:90:359]) rotate([0, 0, a]) translate([base_d / 2 - 18, 0, -1]) cylinder(d = 8, h = 6);
    // agujeros de fijación a la abrazadera (M3 atravesando el piso, patrón 30 mm)
    for (x = [-15, 15]) translate([x, 30, -1]) cylinder(d = m3_paso, h = 6);
    // nivel de burbuja (Ø 15) en el piso
    translate([0, -32, 1.5]) cylinder(d = 15.4, h = 3);
  }
}

if (parte == "embudo") pluv_embudo();
if (parte == "base") pluv_base();
if (parte == "balancin") pluv_balancin();
if (parte == "todo") pluv_armado();
module pluv_armado() {
  color("#e9e4d8") pluv_base();
  color("#c9862b") translate([0, 0, eje_z - eje_b]) pluv_balancin();
  color("#2f6d4f", 0.85) translate([0, 0, base_h - falda]) pluv_embudo();
}

// para chequeo.scad: balancín apoyado en un tope (inclinado `incl` grados) y embudo puesto
module balancin_en_sitio(incl = 0) translate([0, 0, eje_z]) rotate([0, incl, 0]) translate([0, 0, -eje_b]) pluv_balancin();
module embudo_en_sitio() translate([0, 0, base_h - falda]) pluv_embudo();
module tornillos_tope(sobresale = 5) for (s = [-1, 1]) translate([s * 22, 0, 0]) cylinder(d = 5.5, h = tope_h + sobresale);
