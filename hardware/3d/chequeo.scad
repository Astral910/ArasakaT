// Chequeo de interferencias: cada caso es la intersección de dos piezas armadas; tiene que dar vacío.
// Lo corre exportar.sh (OpenSCAD responde "Current top level object is empty" = sin choque).
use <caja.scad>
use <pluviometro.scad>
use <abrigo.scad>
use <abrazadera.scad>
use <protector.scad>
caso = "caja_tapa";
// la tapa apoya en el borde de la pared (contacto plano): se separa 0,01 mm para que el contacto no cuente como choque
if (caso == "caja_tapa")        intersection() { caja_base(); translate([0, 0, 0.01]) tapa_en_sitio(); }
if (caso == "caja_junta_base")  intersection() { caja_base(); translate([0, 0, 0.01]) junta_en_sitio(); }
if (caso == "pluv_nivel")       intersection() { union() { pluv_base(); tornillos_tope(); } balancin_en_sitio(0); }
if (caso == "pluv_volcado_der") intersection() { pluv_base(); balancin_en_sitio(22); }
if (caso == "pluv_volcado_izq") intersection() { pluv_base(); balancin_en_sitio(-22); }
if (caso == "pluv_embudo")      intersection() { pluv_base(); embudo_en_sitio(); }
if (caso == "pluv_embudo_bal")  intersection() { embudo_en_sitio(); balancin_en_sitio(22); }
if (caso == "abrigo_base_p1")   intersection() { abrigo_base(); plato_en(1); }
if (caso == "abrigo_p1_p2")     intersection() { plato_en(1); plato_en(2); }
if (caso == "abrigo_p6_techo")  intersection() { plato_en(6); techo_en(); }
if (caso == "abraz_tubo")       intersection() { tubo(); union() { con_placa("caja"); contra(); } }
if (caso == "abraz_mitades")    intersection() { con_placa("caja"); contra(); }
if (caso == "estaca_tubo")      intersection() { estaca(); tubo_en_estaca(); }
if (caso == "protector_tapa")   intersection() { prot_tapa(); pcb_tapa(); }
if (caso == "protector_punta")  intersection() { prot_punta(); pcb_punta(); }
