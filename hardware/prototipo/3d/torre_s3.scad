// Field Shift · torre del prototipo (v2, medidas reales)
// Placa: VCC-GND Studio YD-ESP32-S3 ("YD-ESP32-23 2022-V1.3"), PCB 57.15 × 27.94 mm, paso 2.54,
//        filas de pines a 25.4 mm, antena del módulo WROOM-1 asomando ~7 mm, 2 USB-C en el borde opuesto.
//        Se monta PARADA: USB-C arriba (se enchufa la power bank desde arriba), antena abajo en una copa.
// Sonda: HW-080 / YL-69, 60 × 20 × 1.6 mm, cabeza ~20 mm con 2 agujeros Ø3, patitas abajo saliendo por el piso.
// Impresión: PLA, boquilla 0.4, capa 0.2, 3 perímetros, 15 % gyroid, SIN soportes.
//   cuerpo: de pie (abierto arriba) · tapa: boca abajo (la cara con texto sobre la cama).
//   Opcional AMS: imprimí "texto" junto con el cuerpo como parte del mismo objeto, en otro color.
parte = "todo";  // "cuerpo" | "tapa" | "texto" | "todo" | "chequeo"

// ---------- placa ----------
pcb_l = 57.15; pcb_w = 27.94; pcb_t = 1.6;
ant_l = 7.0;  ant_w = 18.0; ant_t = 0.9; ant_x = 0.9;   // antena (sustrato del módulo, del lado de adelante)
mod_t = 3.3;                                             // alto del módulo sobre la cara frontal
hdr_t = 2.5;                                             // plástico negro de la tira de pines (atrás)
dupont = 14 + 3;                                         // conector Dupont + curva del cable
usb = [[-6.6, 12.5], [3.4, 12.5]];                       // x del centro de cada USB-C (placa al revés) y ancho del enchufe
// ---------- sonda ----------
son_w = 20.0; son_t = 1.6; cab_h = 20; son_l = 60;
// ---------- caja ----------
pared = 2.4; piso = 3; r = 4; h = 0.25;                  // h = holgura
frente = mod_t + 1.2;
iw = pcb_w + 1.2;
id = frente + pcb_t + hdr_t + dupont + 11;               // atrás queda lugar para el canal de la sonda
copa = 8.5;
ih = copa + pcb_l + 0.25;
ow = iw + 2*pared; od = id + 2*pared; oh = piso + ih;
cx = ow/2;
pcb_y = pared + frente;                                  // cara frontal de la placa
son_y = pared + id - 5;                                  // ranura de la sonda (atrás)
tapa_t = 3; labio = 4;
$fn = 48;

module redondo(s, rr, ch = 0) {  // caja con esquinas verticales redondeadas y chaflán abajo
  hull() for (x = [rr, s[0]-rr], y = [rr, s[1]-rr]) translate([x, y, 0]) {
    translate([0, 0, ch]) cylinder(r = rr, h = s[2] - ch);
    if (ch > 0) cylinder(r1 = rr - ch, r2 = rr, h = ch);
  }
}

module cuerpo_bruto() {
  difference() {
    union() {
      difference() {
        redondo([ow, od, oh], r, 1.2);
        translate([pared, pared, piso]) redondo([iw, id, oh], 1.2);
      }
      // copa de la antena
      translate([cx - 11, pcb_y - 3.5, piso]) cube([22, 3.5 + pcb_t + 2, copa]);
      // costillas que guían la placa (adelante, toda la altura; atrás, solo arriba, contra el plástico de los pines)
      for (s = [-1, 1]) {
        translate([cx + s*(iw/2) - (s > 0 ? 1.0 : 0), pcb_y - 2, piso + copa]) cube([1.0, 2 - h, pcb_l - labio - 1]);
        translate([cx + s*(iw/2) - (s > 0 ? 2.0 : 0), pcb_y + pcb_t + hdr_t + h, piso + 25]) cube([2.0, 2, pcb_l + copa - 25 - labio - 1]);
      }
      // canal de la sonda
      translate([cx - (son_w + 6)/2, son_y - 2.6, piso]) cube([son_w + 6, son_t + 0.5 + 5.2, cab_h]);
    }
    // ranura de la antena
    translate([cx + ant_x - (ant_w + 1)/2, pcb_y - ant_t - 0.5, piso + 1]) cube([ant_w + 1, ant_t + 0.9, copa + 1]);
    // ranura de la sonda (atraviesa el piso)
    translate([cx - (son_w + 0.6)/2, son_y, -1]) cube([son_w + 0.6, son_t + 0.5, cab_h + piso + 2]);
    // ojales para trabar la sonda: tornillo M3 × 10, clip o 1.75 mm de filamento por sus agujeros
    for (s = [-1, 1]) translate([cx + s*7 - 1.65, son_y - 4, piso + cab_h - 10]) cube([3.3, son_t + 8.5, 9]);
    // ventana de los LED (encendido + RGB)
    translate([cx - 8, -1, piso + copa + pcb_l - 19]) rotate([-90, 0, 0]) linear_extrude(pared + 2) offset(r = 2) offset(delta = -2) square([16, 10]);
  }
}

module letras(prof) {
  translate([cx, prof, piso + 20]) rotate([90, 0, 0]) linear_extrude(prof + 0.01) {
    text("FIELD SHIFT", size = 3.9, halign = "center", font = "Liberation Sans:style=Bold", spacing = 1.05);
    translate([0, -6.2]) text("HUMEDAD DEL SUELO", size = 2.6, halign = "center", font = "Liberation Sans:style=Bold");
  }
  // hoja (brote) sobre el texto
  translate([cx, prof, piso + 28.5]) rotate([90, 0, 0]) linear_extrude(prof + 0.01) {
    intersection() { translate([-2.2, 0]) circle(3.4); translate([2.2, 0]) circle(3.4); }
  }
}

module cuerpo() { difference() { cuerpo_bruto(); letras(0.6); } }
module texto()  { intersection() { redondo([ow, od, oh], r, 1.2); letras(0.6); } }

module tapa() {
  difference() {
    union() {
      hull() for (x = [r, ow-r], y = [r, od-r]) translate([x, y, 0]) {
        cylinder(r = r, h = tapa_t - 0.8);
        translate([0, 0, tapa_t - 0.8]) cylinder(r1 = r, r2 = r - 0.8, h = 0.8);
      }
      // labio que entra en la boca de la caja
      translate([pared + h, pared + h, -labio]) difference() {
        redondo([iw - 2*h, id - 2*h, labio], 1.2 - h);
        translate([1.6, 1.6, -1]) cube([iw - 2*h - 3.2, id - 2*h - 3.2, labio + 2]);
      }
    }
    // el labio no toca la placa ni sus costillas
    translate([pared - 1, pcb_y - 3, -labio - 1]) cube([iw + 2, pcb_t + hdr_t + 8, labio + 1]);
    // pasaje de los dos enchufes USB-C
    translate([cx - 1.6 - 12, pcb_y - 1.6 - 3.7, -labio - 1]) linear_extrude(tapa_t + labio + 2) offset(r = 2.5) offset(delta = -2.5) square([24, 7.4]);
  }
}

// piezas reales para el chequeo y la vista armada
module placa() {
  translate([cx - pcb_w/2, pcb_y, piso + copa]) cube([pcb_w, pcb_t, pcb_l]);
  translate([cx + ant_x - ant_w/2, pcb_y - ant_t, piso + copa - ant_l]) cube([ant_w, ant_t, ant_l + 1]);
  translate([cx + ant_x - ant_w/2, pcb_y - mod_t, piso + copa]) cube([ant_w, mod_t, 25.5 - ant_l]);
  for (s = [-1, 1]) translate([cx + s*12.7 - 1.27, pcb_y + pcb_t, piso + copa]) cube([2.54, hdr_t, pcb_l]);
  for (u = usb) translate([cx + u[0] - 4.5, pcb_y - 3.2, piso + copa + pcb_l - 7.3]) cube([9, 3.2, 7.3]);
}
module sonda() {
  translate([cx - son_w/2, son_y + 0.25, piso + cab_h - son_l]) cube([son_w, son_t, son_l]);
}

if (parte == "cuerpo") cuerpo();
else if (parte == "texto") texto();
else if (parte == "tapa") translate([0, 0, tapa_t]) rotate([180, 0, 0]) tapa();
else if (parte == "chequeo") { intersection() { cuerpo(); placa(); } intersection() { cuerpo(); sonda(); } intersection() { translate([0, 0, oh]) tapa(); placa(); } }
else { cuerpo(); color("orange") texto(); translate([0, 0, oh + 0.3]) tapa(); %placa(); %sonda(); }
