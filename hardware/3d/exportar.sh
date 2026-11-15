#!/usr/bin/env bash
# Exporta STL, 3MF y renders PNG de todas las piezas, y corre el chequeo de interferencias.
# Uso: bash hardware/3d/exportar.sh   (OpenSCAD 2021.01+; en Windows usa openscad.com)
set -u
cd "$(dirname "$0")"
OS="${OPENSCAD:-/c/Program Files/OpenSCAD/openscad.com}"
mkdir -p stl 3mf render
piezas=(
  "caja base" "caja tapa" "caja junta"
  "pluviometro embudo" "pluviometro base" "pluviometro balancin"
  "abrigo plato" "abrigo techo" "abrigo base"
  "abrazadera abrazadera_caja" "abrazadera abrazadera_brazo" "abrazadera abrazadera_contra" "abrazadera estaca"
  "soporte_panel bandeja" "soporte_panel oreja"
  "protector tapa" "protector punta"
)
fallos=0
for p in "${piezas[@]}"; do
  set -- $p; f=$1; parte=$2; n="${f}_${parte}"
  [ "$f" = "$parte" ] && n="$f"
  "$OS" -q -o "stl/$n.stl" -D "parte=\"$parte\"" "$f.scad" || { echo "FALLO stl $n"; fallos=$((fallos+1)); }
  # 3MF desde el STL recién hecho (sin repetir las operaciones booleanas)
  echo "import(\"$(pwd -W 2>/dev/null || pwd)/stl/$n.stl\");" > "/tmp/_3mf_$n.scad"
  ( cd "$(pwd)" && "$OS" -q -o "3mf/$n.3mf" "/tmp/_3mf_$n.scad" ) || { echo "FALLO 3mf $n"; fallos=$((fallos+1)); }
  "$OS" -q -o "render/$n.png" -D "parte=\"$parte\"" --imgsize=900,700 --viewall --autocenter --colorscheme=Tomorrow "$f.scad" || echo "FALLO png $n"
  echo "ok $n"
done
for f in caja pluviometro abrigo soporte_panel; do
  "$OS" -q -o "render/${f}_armado.png" -D 'parte="todo"' --imgsize=1200,900 --viewall --autocenter --colorscheme=Tomorrow "$f.scad" && echo "ok render ${f}_armado"
done
echo "--- chequeo de interferencias (tiene que dar vacío) ---"
for c in caja_tapa caja_junta_base pluv_nivel pluv_volcado_der pluv_volcado_izq pluv_embudo pluv_embudo_bal \
         abrigo_base_p1 abrigo_p1_p2 abrigo_p6_techo abraz_tubo abraz_mitades estaca_tubo protector_tapa protector_punta; do
  out=$("$OS" -o "/tmp/chequeo_$c.stl" -D "caso=\"$c\"" chequeo.scad 2>&1)
  if echo "$out" | grep -qi "top level object is empty"; then echo "LIBRE  $c"; else echo "CHOCA  $c"; fallos=$((fallos+1)); fi
done
echo "fallos: $fallos"
exit $fallos
