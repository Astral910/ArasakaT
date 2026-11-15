// SEED · estación de campo (v3): power bank escondida, sonda y placa inmóviles.
// Ejes: X a lo largo del frente (SEED), Y de frente (0) a dorso, Z arriba. Medidas en mm.
// Placa: YD-ESP32-S3 ("YD-ESP32-23 2022-V1.3") PARADA, USB-C arriba, el módulo mira a +X.
//        La power bank (Energizer 2-in-1 5000 mAh, conector Type-C integrado) va acostada encima,
//        con el conector hacia abajo metido en el USB-C "COM" (izquierda vista de frente, USB arriba).
// Sonda: HW-080 en el extremo +X, trabada por 2 pernos impresos (sus agujeros Ø3) + una cuña.
// Impresión: A2L, PLA Basic, 0.20 Standard, boquilla 0.4, SIN soportes, una sola placa:
//   cuerpo de pie · tapa boca abajo · cuña acostada.
parte = "todo";  // "cuerpo" | "tapa" | "cuna" | "placa_impresion" | "todo" | "despiece" | "corte"
                 // chequeos (cada uno debe dar vacío): "c_placa" "c_banco" "c_sonda" "c_cuna" "c_tapa"

// ---------- power bank (estimada con fotos + regla; ver estado/carcasa.md) ----------
pb_l = 79.5;  pb_h = 38;  pb_t = 25;     // largo (X), alto (Z), grosor (Y)
pb_tmax = 26;                            // el bolsillo admite hasta este grosor
pb_r = 8;                                // radio de los cantos redondeados (lados cortos)
pb_gap = 1.0;                            // cuerpo de la power bank sobre la boca del USB-C de la placa
led_dz = 9;                              // LED de batería: altura sobre el borde del conector
hb = 0.4;                                // holgura alrededor de la power bank
// ---------- placa ----------
pcb_l = 57.15; pcb_w = 27.94; pcb_t = 1.6;
ant_l = 7.0;  ant_w = 18.0; ant_t = 0.9; ant_y = 0.9;   // antena del módulo (cara +X), corrida 0.9 en Y
mod_t = 3.3;  hdr_t = 2.5;  dupont = 17;                 // módulo, plástico de los pines (-X), Dupont + curva
usb_com = -6.6; usb_usb = 3.4; usb_t = 3.2;              // centro de cada USB-C respecto del centro de la placa (Y)
// ---------- sonda ----------
son_w = 20.0; son_t = 1.6; son_l = 60; cab = 18;         // cab = cabeza sobre el piso
son_ag = 7; son_agz = 3.0;                                // agujeros: ±7 en Y, 3 mm bajo el borde
// ---------- caja ----------
pared = 2.0; piso = 2.0; r = 6; ri = 1.5; h = 0.2;   // ri: esquina interna (no roza los cantos de la power bank)
IX = pb_l + 2*hb;                                         // 80.3
IY = pb_tmax/2 + hb + (-usb_com) + pcb_w/2 + 1.0;         // 35.0
OX = IX + 2*pared; OY = IY + 2*pared;
sx = pared + IX/2;                                        // centro del USB-C COM (X)
sy = pared + pb_tmax/2 + hb;                              // centro del USB-C COM (Y)
by = sy - usb_com;                                        // centro de la placa (Y)
pcb_f = sx - usb_t/2;  pcb_b = pcb_f - pcb_t;             // caras de la placa (+X módulo, -X pines)
copa = 8.5;
pcb_z = piso + copa;  pcb_top = pcb_z + pcb_l;
pb_z = pcb_top + pb_gap;
OH = pb_z + pb_h + 1.0;                                   // borde del cuerpo = apoyo de la tapa
tapa_t = 2.4; labio = 5; reb = 1.0;                       // la tapa encaja en un rebaje de 1 mm del borde
xe = pared + IX;                                          // cara interna del extremo +X
ym = pared + IY/2;                                        // eje de la sonda (Y)
canal = 5.0;                                              // canal de la sonda (sonda + perno + juego)
peg_d = 2.4; peg_l = son_t + 0.25 + 1.0;
son_x = xe - son_t - 0.25;                                // cara -X de la sonda puesta
cuna_t = canal - son_t - 0.25 - 0.2;
cuna_top = pb_z - 1.2;
leng = [sx - 7.4, sx + 0.6]; leng_z = 38;                 // lengüeta que traba el borde de arriba de la placa
diente = 2.6;
$fn = 40;

module rrect(x, y, rr) { offset(r = rr) offset(delta = -rr) square([x, y]); }
module caja(s, rr, ch = 0) {   // esquinas verticales redondeadas, chaflán abajo
  hull() {
    translate([0, 0, ch]) linear_extrude(s[2] - ch) rrect(s[0], s[1], rr);
    if (ch > 0) translate([ch, ch, 0]) linear_extrude(ch) rrect(s[0] - 2*ch, s[1] - 2*ch, rr - ch);
  }
}

// ---------- marca ----------
F_SEED = "Segoe UI Black"; F_B = "Segoe UI:style=Bold"; F_C = "Bahnschrift:style=Bold Condensed";
module frente_2d() {
  translate([0, 55]) text("SEED", size = 17, halign = "center", font = F_SEED, spacing = 1.08, $fn = 24);
  translate([0, 43]) text("from ArasakaT", size = 5.5, halign = "center", font = F_B, $fn = 24);
}
module logo_2d() {   // NASA Space Apps Challenge: anillo con la antenita + texto
  difference() { circle(d = 21, $fn = 64); circle(d = 18.4, $fn = 64); }
  rotate(48) translate([10.5, 0]) {
    difference() { circle(d = 5, $fn = 32); circle(d = 2.6, $fn = 32); }
    for (a = [-38, 0, 38]) rotate(a) translate([3.1, -0.4]) square([4.2, 0.8]);
  }
  translate([34, 0]) {
    translate([0, 6.4]) text("NASA", size = 3.4, halign = "center", font = F_C, spacing = 1.2, $fn = 20);
    translate([0, -2.6]) text("SPACE APPS", size = 7.6, halign = "center", font = F_C, $fn = 20);
    translate([0, -8.6]) text("CHALLENGE", size = 3.4, halign = "center", font = F_C, spacing = 1.75, $fn = 20);
  }
}
module dorso_2d() {
  translate([-22, 88]) logo_2d();
  translate([0, 10]) text("15 NOV 2026", size = 4.2, halign = "center", font = F_B, spacing = 1.1, $fn = 20);
}
prof = 0.6;
module grabado() {
  translate([OX/2, -0.01, 0]) rotate([90, 0, 0]) translate([0, 0, -prof]) linear_extrude(prof + 0.5) frente_2d();
  translate([OX/2, OY + 0.01, 0]) rotate([90, 0, 180]) translate([0, 0, -prof]) linear_extrude(prof + 0.5) dorso_2d();
}

// ---------- cuerpo ----------
module cuerpo() {
  difference() {
    union() {
      difference() {
        caja([OX, OY, OH], r, 0.8);
        translate([pared, pared, piso]) linear_extrude(OH) rrect(IX, IY, ri);
        // rebaje del borde donde entra el labio de la tapa
        translate([pared - reb, pared - reb, OH - labio]) linear_extrude(labio + 1) rrect(IX + 2*reb, IY + 2*reb, r - pared + reb);   // concéntrico con la esquina de afuera
      }
      // copa: apoya el borde de abajo de la placa; la antena entra en su ranura
      translate([pcb_b - 3, by - 11, piso - 0.01]) cube([pcb_f + 3.5 - (pcb_b - 3), 22, copa]);
      translate([pcb_b - 0.2 - 1.2, by - 11, pcb_z - 0.01]) cube([1.2, 22, 2]);           // reborde detrás de la placa
      // canal de la sonda: costillas de apoyo de la cuña (desde el frente y el dorso)
      for (s = [-1, 1]) {
        y0 = s < 0 ? pared - 0.01 : ym + 8;
        translate([xe - canal - 2, y0, piso - 0.01]) cube([2, s < 0 ? ym - 8 - pared + 0.01 : pared + IY - ym - 8 + 0.01, cuna_top + 1 - piso]);
      }
      // pernos que entran en los agujeros de la sonda
      for (s = [-1, 1]) translate([xe + 0.01, ym + s*son_ag, piso + cab - son_agz]) rotate([0, -90, 0]) {
        cylinder(d = peg_d, h = peg_l, $fn = 24);
      }
      // topes de la power bank contra el dorso (con escuadra a 45° abajo: sin soportes)
      for (x = [sx - 30, sx + 30]) translate([x - 1, sy + pb_tmax/2 + hb, 0]) {
        d = pared + IY - (sy + pb_tmax/2 + hb) + 0.01;
        hull() {
          translate([0, 0, pb_z]) cube([2, d, OH - labio - 0.3 - pb_z]);
          translate([0, d - 0.01, pb_z - d]) cube([2, 0.01, 1]);
        }
      }
      // diente de la lengüeta: traba el borde de arriba de la placa
      translate([0, pared + IY, pcb_top + 0.2]) hull() {
        translate([pcb_b - hdr_t, -diente, 0]) cube([pcb_f + 0.5 - (pcb_b - hdr_t), diente, 0.8]);
        translate([pcb_b - hdr_t, -0.01, 0]) cube([pcb_f + 0.5 - (pcb_b - hdr_t), 0.01, diente + 0.8]);
      }
    }
    // ranura de la antena
    translate([pcb_f - 0.3, by + ant_y - (ant_w + 1)/2, piso + 1]) cube([ant_t + 0.9, ant_w + 1, copa]);
    // la sonda atraviesa el piso
    translate([xe - canal, ym - son_w/2 - 0.4, -1]) cube([canal + 0.01, son_w + 0.8, piso + 2]);
    // ventana de los LED de la power bank: la línea fina sobre SEED
    translate([sx, -1, pb_z + led_dz]) rotate([-90, 0, 0]) linear_extrude(pared + 2) hull() for (x = [-9.5, 9.5]) translate([x, 0]) circle(d = 3, $fn = 24);
    // lengüeta: ranura en U (esquinas redondeadas) en el dorso; se empuja desde afuera para soltar la placa
    translate([0, pared + IY + pared + 1, 0]) rotate([90, 0, 0]) linear_extrude(pared + 2) difference() {
      translate([leng[0] - 1, leng_z]) rrect(leng[1] - leng[0] + 2, pcb_top + diente + 5 - leng_z, 1.5);
      translate([leng[0], leng_z - 5]) rrect(leng[1] - leng[0], pcb_top + diente + 3 - leng_z + 5, 1);
    }
    // muesca para levantar la tapa con la uña (extremo -X)
    translate([-1, OY/2, OH + 3.5]) rotate([0, 90, 0]) cylinder(r = 6, h = pared + 2);
    grabado();
  }
}

// ---------- tapa (armada: apoya en OH) ----------
module tapa() {
  union() {
    hull() {
      linear_extrude(tapa_t - 0.8) rrect(OX, OY, r);
      translate([0.8, 0.8, 0]) linear_extrude(tapa_t) rrect(OX - 1.6, OY - 1.6, r - 0.8);
    }
    translate([pared - reb + h*0.75, pared - reb + h*0.75, -labio]) linear_extrude(labio + 0.01) difference() {
      rrect(IX + 2*reb - 1.5*h, IY + 2*reb - 1.5*h, r - pared + reb - h*0.75);
      translate([reb - h*0.75, reb - h*0.75]) rrect(IX, IY, ri);
    }
  }
}

// ---------- cuña de la sonda (armada) ----------
module cuna() {
  x0 = xe - canal + 0.1;
  difference() {
    union() {
      for (s = [-1, 1]) translate([x0, ym + (s < 0 ? -10 : 4), piso + 0.3]) cube([cuna_t, 6, cuna_top - piso - 0.3]);
      translate([x0, ym - 10, cuna_top - 6]) cube([cuna_t, 20, 6]);
    }
    // canaletas para las puntas de los pernos
    for (s = [-1, 1]) translate([xe - peg_l - 0.5, ym + s*son_ag - 1.7, piso - 1]) cube([3, 3.4, cab - son_agz + 2.5]);
  }
}

// ---------- piezas reales (chequeo y vistas) ----------
module placa() {
  translate([pcb_b, by - pcb_w/2, pcb_z]) cube([pcb_t, pcb_w, pcb_l]);
  translate([pcb_f, by + ant_y - ant_w/2, pcb_z - ant_l]) cube([ant_t, ant_w, ant_l + 1]);
  translate([pcb_f, by + ant_y - ant_w/2, pcb_z]) cube([mod_t, ant_w, 25.5 - ant_l]);
  for (s = [-1, 1]) translate([pcb_b - hdr_t, by + s*12.7 - 1.27, pcb_z + 0.6]) cube([hdr_t, 2.54, pcb_l - 0.6]);
  for (u = [usb_com, usb_usb]) translate([pcb_f, by + u - 4.5, pcb_top - 7.3]) cube([usb_t, 9, 7.3]);
}
module dupont_zona() {   // conectores Dupont enchufados en los pines (atrás de la placa)
  for (s = [-1, 1]) translate([pcb_b - hdr_t - dupont, by + s*12.7 - 1.27, pcb_z + 0.6]) cube([dupont, 2.54, pcb_l - 0.6]);
}
module banco() {
  translate([sx - pb_l/2, sy - pb_t/2, pb_z]) hull() for (x = [pb_r, pb_l - pb_r]) translate([x, 0, 0])
    intersection() { translate([0, pb_t/2, pb_h/2]) rotate([90, 0, 0]) cylinder(r = pb_r, h = pb_t, center = true); translate([-pb_r, 0, 0]) cube([2*pb_r, pb_t, pb_h]); }
  translate([sx - pb_l/2 + pb_r, sy - pb_t/2, pb_z]) cube([pb_l - 2*pb_r, pb_t, pb_h]);
}
module enchufe() { translate([sx - 1.3, sy - 4.2, pb_z - pb_gap - 6.6]) cube([2.6, 8.4, pb_gap + 6.6 + 0.01]); }
module sonda() {
  difference() {
    translate([son_x, ym - son_w/2, piso + cab - son_l]) cube([son_t, son_w, son_l]);
    for (s = [-1, 1]) translate([son_x - 1, ym + s*son_ag, piso + cab - son_agz]) rotate([0, 90, 0]) cylinder(d = 3, h = 4, $fn = 24);
  }
  translate([son_x, ym - 2.5, piso + cab]) cube([son_t, 5.1, 8.5 + 14]);   // pines + Dupont hacia arriba
}

// ---------- salida ----------
if (parte == "cuerpo") cuerpo();
else if (parte == "tapa") translate([0, OY, tapa_t]) rotate([180, 0, 0]) tapa();
else if (parte == "cuna") rotate([0, 90, 0]) translate([-(xe - canal + 0.1) - cuna_t, -ym, -piso]) cuna();
else if (parte == "placa_impresion") {
  cuerpo();
  translate([0, OY + 6, 0]) translate([0, OY, tapa_t]) rotate([180, 0, 0]) tapa();
  translate([OX + 8, 0, 0]) rotate([0, 90, 0]) translate([-(xe - canal + 0.1) - cuna_t, -ym, -piso]) cuna();
}
else if (parte == "c_placa")  intersection() { cuerpo(); union() { placa(); dupont_zona(); } }
else if (parte == "c_banco")  { intersection() { cuerpo(); union() { banco(); enchufe(); } } intersection() { translate([0, 0, OH]) tapa(); banco(); } intersection() { banco(); union() { placa(); dupont_zona(); cuna(); } } }
else if (parte == "c_sonda")  { intersection() { cuerpo(); sonda(); } intersection() { cuna(); sonda(); } intersection() { sonda(); union() { placa(); dupont_zona(); } } }
else if (parte == "c_cuna")   { intersection() { cuerpo(); cuna(); } intersection() { cuna(); union() { placa(); dupont_zona(); } } }
else if (parte == "c_tapa")   { intersection() { cuerpo(); translate([0, 0, OH]) tapa(); } intersection() { translate([0, 0, OH]) tapa(); placa(); } }
else if (parte == "corte") {
  difference() { cuerpo(); translate([-1, -1, -1]) cube([OX + 2, sy, OH + 2]); }
  color("SteelBlue") placa(); color("Gold") sonda(); color("Orange") cuna(); color("White", 0.9) banco();
}
else if (parte == "despiece") {
  cuerpo(); color("Gainsboro") translate([0, 0, OH + 45]) tapa();
  color("Orange") translate([0, 0, 0]) translate([0, -45, 0]) cuna();
  color("White") translate([0, 0, 25]) banco();
  color("SteelBlue") placa(); color("Gold") sonda();
}
else { cuerpo(); color("Gainsboro") translate([0, 0, OH]) tapa(); %placa(); %banco(); %sonda(); %cuna(); }
