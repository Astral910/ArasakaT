// Protector del sensor capacitivo de humedad (tipo v1.2/v2.0, placa de 98 × 23 × 1,6 mm):
//  - prot_tapa(): capuchón para la parte electrónica (los 30 mm de arriba). Se llena con silicona neutra o
//    resina epoxi; el cable sale por arriba con un pasacable. La electrónica sin proteger es lo primero
//    que falla en el campo (humedad, corrosión del 555 y del regulador).
//  - prot_punta(): funda en U de 12 mm para el filo inferior de la placa (cobre del corte expuesto) que además
//    abre camino al clavarlo. Va pegada; los bordes cortados se sellan antes con barniz de uñas o epoxi.
// La zona de medición (entre la punta y la línea blanca) NO se cubre: va en contacto directo con el suelo.
// Impresión: tapa de pie (abierta abajo) sin soportes; punta de pie sin soportes.
include <comun.scad>

pcb_a = 23.0; pcb_e = 1.6; comp = 4.5;   // ancho, espesor de la placa y alto de componentes
tapa_h = 32; tw = 1.6;
parte = "tapa"; // tapa | punta

module prot_tapa() {
  ai = pcb_a + 2 * tol;
  ei = pcb_e + comp + 2 * tol;
  difference() {
    translate([-ai / 2 - tw, -ei / 2 - tw, 0]) cube([ai + 2 * tw, ei + 2 * tw, tapa_h + tw]);
    translate([-ai / 2, -ei / 2, -0.01]) cube([ai, ei, tapa_h]);
    translate([0, 0, tapa_h - 1]) cylinder(d = 5, h = tw + 2);    // cable (Ø 4 + juego)
  }
}
module prot_punta() {
  h = 12;
  difference() {
    hull() {
      translate([-pcb_a / 2 - tw - tol, -pcb_e / 2 - tw - tol, 4]) cube([pcb_a + 2 * tw + 2 * tol, pcb_e + 2 * tw + 2 * tol, h - 4]);
      translate([-pcb_a / 4, -pcb_e / 2 - tw - tol, 0]) cube([pcb_a / 2, pcb_e + 2 * tw + 2 * tol, 1]);
    }
    translate([-pcb_a / 2 - tol, -pcb_e / 2 - tol, 3]) cube([pcb_a + 2 * tol, pcb_e + 2 * tol, h]);
  }
}
if (parte == "tapa") prot_tapa();
if (parte == "punta") prot_punta();

// para chequeo.scad: placa del sensor (con componentes) dentro de la tapa y de la punta
module pcb_tapa() translate([-pcb_a / 2, -(pcb_e + comp) / 2, -60]) cube([pcb_a, pcb_e + comp, 60 + tapa_h - 2]);
module pcb_punta() translate([-pcb_a / 2, -pcb_e / 2, 3.01]) cube([pcb_a, pcb_e, 80]);
