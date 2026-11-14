"""Servicio local de voz a texto para el bot de Field Shift.

faster-whisper en la GPU (CUDA, float16). Escucha en 127.0.0.1:8211.

  GET  /salud                    -> {"ok":true,"modelo":"small","dispositivo":"cuda"}
  POST /transcribir[?idioma=es]  -> cuerpo = audio crudo (OGG/Opus de WhatsApp, mp3, wav…)
                                    {"texto":"…","idioma":"es","prob_idioma":0.98,
                                     "duracion":2.1,"segundos":0.31,"dispositivo":"cuda"}

Variables: STT_MODELO (small|medium|large-v3-turbo, por defecto small), STT_PUERTO (8211),
STT_DISPOSITIVO (cuda|cpu; por defecto cuda y cae a cpu si no hay GPU).
Solo stdlib + faster-whisper + ffmpeg (decodifica el audio): sin Flask.
"""

import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def _dll_cuda():
    """En Windows, los DLL de cuBLAS/cuDNN vienen en los wheels nvidia-*-cu12: hay que registrarlos."""
    if os.name != "nt":
        return
    import site

    bases = site.getsitepackages() + [site.getusersitepackages()]
    for base in bases:
        raiz = os.path.join(base, "nvidia")
        if not os.path.isdir(raiz):
            continue
        for lib in os.listdir(raiz):
            bin_ = os.path.join(raiz, lib, "bin")
            if os.path.isdir(bin_):
                os.add_dll_directory(bin_)
                os.environ["PATH"] = bin_ + os.pathsep + os.environ.get("PATH", "")


_dll_cuda()

from faster_whisper import WhisperModel  # noqa: E402
import numpy as np  # noqa: E402

MODELO = os.environ.get("STT_MODELO", "small")
PUERTO = int(os.environ.get("STT_PUERTO", "8211"))
FFMPEG = os.environ.get("STT_FFMPEG", "ffmpeg")
IDIOMAS = ("es", "en")

# Vocabulario del bot: sesga a Whisper hacia las palabras que esperamos oír.
PISTA = {
    "es": "Milpa, maíz, frijol, sorgo. Dos manzanas, tres cuerdas, una hectárea. "
    "No riego, riego poco. Sí, ya sembré. Jocotán, Camotán, Olopa, Chiquimula, San Juan Ermita, "
    "Quetzaltepeque, Esquipulas, Zacapa, Jalapa, Huehuetenango, Quiché, Cobán.",
    "en": "Milpa, maize, beans, sorghum. Two manzanas, one hectare. No irrigation. Yes, I planted.",
}


def _cargar():
    pedido = os.environ.get("STT_DISPOSITIVO", "cuda")
    if pedido == "cuda":
        try:
            m = WhisperModel(MODELO, device="cuda", compute_type="float16")
            return m, "cuda"
        except Exception as e:  # sin GPU o sin DLL: seguimos en CPU y lo decimos
            print(f"[stt] CUDA no disponible ({e}); uso CPU", file=sys.stderr, flush=True)
    return WhisperModel(MODELO, device="cpu", compute_type="int8"), "cpu"


t0 = time.time()
modelo, DISPOSITIVO = _cargar()
_lock = threading.Lock()  # un modelo, una GPU: de a una transcripción


def decodificar(audio_bytes: bytes):
    """Audio de WhatsApp (OGG/Opus u otro) → PCM float32 mono 16 kHz con ffmpeg (sin ventana)."""
    flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
    p = subprocess.run(
        [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
         "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
        input=audio_bytes, capture_output=True, creationflags=flags, timeout=60,
    )
    if p.returncode != 0 or not p.stdout:
        raise ValueError(p.stderr.decode("utf-8", "replace").strip()[-300:] or "audio vacío")
    return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def _calentar():
    with _lock:
        list(modelo.transcribe(np.zeros(16000, dtype="float32"), language="es")[0])


_calentar()
print(f"[stt] modelo={MODELO} dispositivo={DISPOSITIVO} cargado en {time.time()-t0:.1f}s", flush=True)


def transcribir(audio_bytes: bytes, idioma: str | None):
    t = time.time()
    audio = decodificar(audio_bytes)
    dur = len(audio) / 16000.0
    with _lock:
        prob = 1.0
        if idioma not in IDIOMAS:
            # El bot solo habla español e inglés: elegimos el más probable de los dos.
            _, _, todos = modelo.detect_language(audio)
            p = dict(todos)
            idioma = max(IDIOMAS, key=lambda k: p.get(k, 0.0))
            tot = sum(p.get(k, 0.0) for k in IDIOMAS) or 1.0
            prob = p.get(idioma, 0.0) / tot
        segs, _ = modelo.transcribe(
            audio,
            language=idioma,
            beam_size=5,
            vad_filter=True,
            initial_prompt=PISTA[idioma],
            condition_on_previous_text=False,
        )
        texto = " ".join(s.text.strip() for s in segs).strip()
    return {
        "texto": texto,
        "idioma": idioma,
        "prob_idioma": round(prob, 3),
        "duracion": round(dur, 2),
        "segundos": round(time.time() - t, 3),
        "modelo": MODELO,
        "dispositivo": DISPOSITIVO,
    }


class Manejador(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if urlparse(self.path).path == "/salud":
            return self._json(200, {"ok": True, "modelo": MODELO, "dispositivo": DISPOSITIVO})
        self._json(404, {"error": "no existe"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/transcribir":
            return self._json(404, {"error": "no existe"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 16 << 20:
            return self._json(400, {"error": "audio vacío o mayor a 16 MB"})
        cuerpo = self.rfile.read(n)
        idioma = (parse_qs(u.query).get("idioma") or [None])[0]
        try:
            self._json(200, transcribir(cuerpo, idioma))
        except Exception as e:
            self._json(422, {"error": f"no pude leer el audio: {e}"})

    def log_message(self, fmt, *args):
        print("[stt] " + fmt % args, flush=True)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador)
    print(f"[stt] escuchando en http://127.0.0.1:{PUERTO}", flush=True)
    srv.serve_forever()
