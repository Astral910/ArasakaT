#!/usr/bin/env bash
# Renders PNG desde los STL (correr después de exportar.sh).
set -u
cd "$(dirname "$0")"
OS="${OPENSCAD:-/c/Program Files/OpenSCAD/openscad.com}"
mkdir -p render
for f in stl/*.stl; do
  n=$(basename "$f" .stl)
  "$OS" -q -o "render/$n.png" -D 'vista="pieza"' -D "archivo=\"$n\"" --imgsize=900,700 --viewall --autocenter --colorscheme=Tomorrow --camera=0,0,0,55,0,25,0 vistas.scad && echo "ok $n"
done
for v in caja pluviometro abrigo panel; do
  "$OS" -q -o "render/${v}_armado.png" -D "vista=\"$v\"" --imgsize=1200,900 --viewall --autocenter --colorscheme=Tomorrow --camera=0,0,0,60,0,35,0 vistas.scad && echo "ok armado $v"
done
"$OS" -q -o "render/pluviometro_abierto.png" -D 'vista="pluviometro_abierto"' --imgsize=1200,900 --viewall --autocenter --colorscheme=Tomorrow --camera=0,0,0,22,0,30,0 vistas.scad && echo "ok pluviometro_abierto"
"$OS" -q -o "render/estacion.png" -D 'vista="estacion"' --imgsize=1000,1400 --viewall --autocenter --colorscheme=Tomorrow --camera=0,0,0,75,0,35,0 vistas.scad && echo "ok estacion"
