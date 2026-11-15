"""Prueba real del texto libre por el bot (simulador de WhatsApp, POST /api/chat): flujo guiado y luego
una pregunta libre que va al asistente. Uso: python scripts/prueba-chat-wa.py [base]"""
import json, sys, time, urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8224"
S = "wa-%d" % time.time()

def chat(texto):
    t0 = time.time()
    req = urllib.request.Request(B + "/api/chat", data=json.dumps({"session_id": S, "texto": texto, "idioma": "es"}).encode(),
                                 headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=150))
    return r, time.time() - t0

for m in ["hola", "Jocotán", "1", "maíz", "media manzana", "sí", "Generame del 1 de julio al 1 de agosto", "hay gusano en el maíz, ¿qué hago?"]:
    r, dt = chat(m)
    print("> %s  (%.1f s)" % (m, dt))
    for x in r:
        print("   [%s] %s%s" % (x.get("tipo"), (x.get("texto") or "").replace("\n", " ⏎ ")[:600], (" VIDEO " + x["video_url"]) if x.get("video_url") else ""))
