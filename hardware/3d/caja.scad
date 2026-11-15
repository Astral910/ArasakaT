// Caja estanca de la electrónica (ESP32-C3 en placa perforada de 5×7 cm, 18650, cargador solar).
// Base abierta arriba con un labio que aprieta una junta de TPU impresa (junta.stl) en la ranura de la tapa.
// 4 insertos M3 para la tapa, 4 PG7 abajo (los cables entran por abajo: el agua no corre hacia adentro),
// 4 insertos M3 atrás para la abrazadera del tubo.
// Impresión: base boca arriba sin soportes; tapa con la cara exterior en la cama sin soportes; junta en TPU 95A.
include <comun.scad>

L = 130; A = 90; H = 62;     // exterior de la base
r = 6;                        // radio de esquinas
tapa_h = 10;
labio_a = 1.2; labio_h = 1.4; // labio en el borde de la base
ran_a = 2.4;  ran_p = 3.0;    // ranura de la junta en la tapa (labio de 1,2 dentro de una ranura de 2,4)
junta_h = 2.0;                // junta de TPU 2,0 alta: labio 1,4 + junta 2,0 = 3,4 en 3,0 de ranura → 0,4 de apriete (20 %)
boss = 9;                     // pilar de los tornillos de la tapa

parte = "base"; // base | tapa | junta | todo

module pg7(x) { translate([x, A / 2, -1]) cylinder(d = pg7_d, h = pared + 2); }

module caja_base() {
  difference() {
    union() {
      difference() {
        redondeado(L, A, H, r);
        translate([pared, pared, pared]) redondeado(L - 2 * pared, A - 2 * pared, H, r - pared / 2);
      }
      // pilares de los tornillos de la tapa
      for (x = [pared, L - pared - boss], y = [pared, A - pared - boss])
        translate([x, y, 0]) cube([boss, boss, H]);
      // labio que aprieta la junta (centrado en la pared)
      translate([0, 0, H]) difference() {
        translate([pared / 2 - labio_a / 2, pared / 2 - labio_a / 2, 0])
          redondeado(L - pared + labio_a, A - pared + labio_a, labio_h, r - pared / 2 + labio_a / 2);
        translate([pared / 2 + labio_a / 2, pared / 2 + labio_a / 2, -1])
          redondeado(L - pared - labio_a, A - pared - labio_a, labio_h + 2, r - pared / 2 - labio_a / 2);
      }
      // soportes de la placa perforada 5×7 cm (agujeros a 2 mm del borde: 46 × 66)
      for (x = [0, 66], y = [0, 46]) translate([14 + x, 14 + y, pared]) cylinder(d = 7, h = 6);
      // cuna de la 18650 (Ø 18,6 → 19,1 con juego), dos apoyos con ranura para precinto
      for (x = [22, 78]) translate([x, A - pared - 14, pared]) difference() {
        translate([-5, -12, 0]) cube([10, 24, 12]);
        translate([-6, 0, 12.5]) rotate([0, 90, 0]) cylinder(d = 18.6 + 0.5, h = 12);
        translate([-1.5, -13, 3]) cube([3, 26, 2.2]); // pasa el precinto
      }
      // pared de refuerzo atrás para los insertos de la abrazadera
      for (x = [L / 2 - 30, L / 2 + 30], z = [H / 2 - 18, H / 2 + 18])
        translate([x, A - pared, z]) rotate([-90, 0, 0]) translate([0, 0, -4]) cylinder(d = 9, h = 4);
    }
    // insertos de la tapa
    for (x = [pared + boss / 2, L - pared - boss / 2], y = [pared + boss / 2, A - pared - boss / 2])
      translate([x, y, H + labio_h - ins_h]) inserto();
    // agujeros de la placa (tornillo M2 autorroscante: Ø 1,8)
    for (x = [0, 66], y = [0, 46]) translate([14 + x, 14 + y, pared]) cylinder(d = 1.8, h = 10);
    // 4 PG7 en el fondo, y respiradero (PG7 con membrana o tornillo de venteo M12)
    for (x = [25, 50, 75, 100]) translate([0, -A / 4 + 2, 0]) pg7(x);
    translate([115, A / 2 - A / 4 + 2, -1]) cylinder(d = pg7_d, h = pared + 2);
    // insertos atrás (abrazadera, patrón 60 × 36)
    for (x = [L / 2 - 30, L / 2 + 30], z = [H / 2 - 18, H / 2 + 18])
      translate([x, A + 0.01, z]) rotate([90, 0, 0]) inserto();
    // agujero de goteo: no; la caja es estanca. Bolsa de sílica gel adentro.
  }
}

module caja_tapa() {
  difference() {
    redondeado(L, A, tapa_h, r);
    // ranura de la junta (de cara a la base: abajo)
    translate([0, 0, -0.01]) difference() {
      translate([pared / 2 - ran_a / 2, pared / 2 - ran_a / 2, 0])
        redondeado(L - pared + ran_a, A - pared + ran_a, ran_p, r - pared / 2 + ran_a / 2);
      translate([pared / 2 + ran_a / 2, pared / 2 + ran_a / 2, -1])
        redondeado(L - pared - ran_a, A - pared - ran_a, ran_p + 2, r - pared / 2 - ran_a / 2);
    }
    // tornillos M3 avellanados
    for (x = [pared + boss / 2, L - pared - boss / 2], y = [pared + boss / 2, A - pared - boss / 2])
      translate([x, y, -1]) {
        cylinder(d = m3_paso, h = tapa_h + 2);
        translate([0, 0, tapa_h - 3]) cylinder(d = m3_cab, h = 4);
      }
    // rebaje interior para aliviar peso (deja 3 mm de techo)
    translate([pared + boss, pared + 2, ran_p + 0.6]) cube([L - 2 * pared - 2 * boss, A - 2 * pared - 4, tapa_h - ran_p - 0.6 - 3]);
    // texto
    translate([L / 2, A / 2, tapa_h - 0.6]) linear_extrude(1) text("FieldShift", size = 9, halign = "center", valign = "center");
  }
}

// junta de TPU: cordón rectangular que entra en la ranura (ancho ranura − 2·tol para que no se trabe)
module caja_junta() {
  ja = ran_a - 2 * 0.15;
  difference() {
    translate([pared / 2 - ja / 2, pared / 2 - ja / 2, 0]) redondeado(L - pared + ja, A - pared + ja, junta_h, r - pared / 2 + ja / 2);
    translate([pared / 2 + ja / 2, pared / 2 + ja / 2, -1]) redondeado(L - pared - ja, A - pared - ja, junta_h + 2, r - pared / 2 - ja / 2);
  }
}

if (parte == "base") caja_base();
if (parte == "tapa") caja_tapa();
if (parte == "junta") caja_junta();
if (parte == "todo") caja_armado();
module caja_armado(abierta = 0) {
  color("#e9e4d8") caja_base();
  translate([0, 0, H + abierta]) {
    color("#1d1d1b") translate([0, 0, labio_h]) scale([1, 1, (ran_p - labio_h) / junta_h]) caja_junta(); // aplastada
    color("#2f6d4f") caja_tapa();
  }
}

// para chequeo.scad
module tapa_en_sitio() translate([0, 0, H]) caja_tapa();
module junta_en_sitio() translate([0, 0, H + labio_h]) scale([1, 1, (ran_p - labio_h) / junta_h]) caja_junta();
