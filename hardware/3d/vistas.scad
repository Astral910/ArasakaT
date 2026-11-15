// Vistas para los renders (desde los STL exportados, color uniforme y sin caras de corte).
// vista = "pieza" (con archivo=...), "caja", "pluviometro", "abrigo", "panel" o "estacion".
vista = "estacion";
archivo = "";
color_pieza = "#d9c7a5";
$fn = 48;
module s(n) import(str("stl/", n, ".stl"));
PETG = "#e9e4d8"; VERDE = "#2f6d4f"; NEGRO = "#1d1d1b"; COBRE = "#c9862b"; AZUL = "#1b3a5c"; BLANCO = "#f6f4ee";

module caja(abierta = 30) {
  color(PETG) s("caja_base");
  color(NEGRO) translate([0, 0, 62 + 1.4 + abierta * 0.5]) s("caja_junta");
  color(VERDE) translate([0, 0, 62 + abierta]) s("caja_tapa");
}
module pluviometro(abierto = 40) {
  color(PETG) s("pluviometro_base");
  color(COBRE) translate([0, 0, 30 + 2.5]) s("pluviometro_balancin");
  color(VERDE, 0.9) translate([0, 0, 85 - 12 + abierto]) s("pluviometro_embudo");
}
module abrigo(abierto = 6) {
  color(BLANCO) s("abrigo_base");
  for (i = [1 : 6]) color(BLANCO) translate([0, 0, (14 + abierto) * i]) s("abrigo_plato");
  color("#e6e2d6") translate([0, 0, (14 + abierto) * 7]) s("abrigo_techo");
}
module panel(ang = 15) {
  color(PETG) for (y = [0, 52]) translate([0, y, 0]) rotate([90, 0, 0]) s("soporte_panel_oreja");
  translate([-75, -12, 40]) rotate([ang, 0, 0]) {
    color(PETG) s("soporte_panel_bandeja");
    color(AZUL) translate([2.65, 2.65, 2.4]) cube([136, 110, 3]);  // el panel
  }
}
// estación completa en el tubo PVC (posiciones aproximadas, para mostrar el conjunto)
module estacion() {
  color("#f2f2f2") translate([0, 0, -200]) cylinder(d = 21.3, h = 1700);
  color(PETG) translate([0, 0, -403]) s("abrazadera_estaca");  // el tubo entra en el vaso de la estaca
  // caja en la abrazadera, a 600 mm
  color(PETG) translate([0, 0, 600]) s("abrazadera_abrazadera_caja");
  color(PETG) translate([0, 0, 600]) s("abrazadera_abrazadera_contra");
  translate([-65, -16.9 - 90, 600 - 5]) caja(0);
  // pluviómetro en un brazo a 1 000 mm
  color(PETG) translate([0, 0, 1000]) rotate([0, 0, 90]) s("abrazadera_abrazadera_brazo");
  translate([120, 0, 1010]) pluviometro(0);
  color(PETG) translate([20, -10, 1000]) cube([60, 20, 6]);
  // abrigo a 1 250 mm del otro lado
  color(PETG) translate([0, 0, 1250]) rotate([0, 0, -90]) s("abrazadera_abrazadera_brazo");
  translate([-130, 0, 1260]) abrigo(0);
  // panel arriba
  color(PETG) translate([0, 0, 1440]) s("abrazadera_abrazadera_brazo");
  translate([0, -40, 1460]) panel(15);
}
if (vista == "pieza") color(color_pieza) s(archivo);
if (vista == "caja") caja();
if (vista == "pluviometro") pluviometro();
if (vista == "abrigo") abrigo();
if (vista == "panel") panel();
if (vista == "estacion") estacion();
// pluviómetro sin el embudo: se ven el balancín (inclinado sobre un tope), el eje, los topes y el reed
if (vista == "pluviometro_abierto") {
  color(PETG) s("pluviometro_base");
  color(COBRE) translate([0, 0, 30]) rotate([0, 18, 0]) translate([0, 0, 2.5]) s("pluviometro_balancin");
  color("#9aa0a6") translate([0, -20, 30]) rotate([-90, 0, 0]) cylinder(d = 2, h = 40);   // eje de 2 mm
  color("#555") for (x = [-22, 22]) translate([x, 0, 12]) cylinder(d = 5.5, h = 4);       // cabezas de los tornillos tope
}
