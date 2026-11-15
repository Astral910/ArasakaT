#!/usr/bin/env bash
# Prueba real del asistente (Claude Code CLI): 3 preguntas por /api/chat/asistente y el texto libre por el bot
# (simulador de WhatsApp, /api/chat). Uso: scripts/prueba-chat-real.sh [base=http://127.0.0.1:8224] > salida.txt
B=${1:-http://127.0.0.1:8224}
CTX='{"pantalla":"sandbox","idioma":"es","municipio_id":"jocotan-chiquimula","cultivo":"maiz","area_m2":437,"siembra":"2026-05-20","lugar":"Jocotán, Chiquimula"}'
CONV="real-$(date +%s)"
for q in "¿Cuánto riego hoy?" "Generame del 1 de julio al 1 de agosto" "Hoy llovió mucho"; do
  echo "### $q"
  t0=$(date +%s.%N)
  curl -s -m 120 -X POST "$B/api/chat/asistente" -H 'Content-Type: application/json' \
    -d "{\"mensaje\":\"$q\",\"conversacion\":\"$CONV\",\"contexto\":$CTX}"
  echo; echo "tiempo_total_s=$(python -c "import time;print(round(time.time()-$t0,1))")"; echo
done
echo "### WhatsApp (simulador del bot): flujo guiado y después texto libre"
S="wa-$(date +%s)"
for m in hola Jocotan "maíz" "media manzana" "sí" "Generame del 1 de julio al 1 de agosto"; do
  t0=$(date +%s.%N)
  r=$(curl -s -m 150 -X POST "$B/api/chat" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S\",\"texto\":\"$m\",\"idioma\":\"es\"}")
  echo "> $m  ($(python -c "import time;print(round(time.time()-$t0,1))") s)"
done
echo "$r"
