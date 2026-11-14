"""Genera la narración de la guía del sandbox con edge-tts (voces es-GT y en-US).

Lee web/src/features/sandbox/audio/frases.json, baja cada clip a tools/tts/cache/ (crudo,
fuera de git) y escribe web/public/audio/voz/<es|en>/<clave>.mp3 recortado (sin silencios
al borde, mono 24 kHz 32 kb/s) + web/public/audio/voz/manifest.json (duración en segundos).
Cachea: no vuelve a pedir lo que ya está en cache/.
Sin red no falla la web: la guía muestra solo subtítulos.

Uso:  python tools/tts/generar.py [--forzar] [--hilos 6]
Requiere: pip install edge-tts ; ffmpeg y ffprobe en el PATH.
"""
import argparse, asyncio, json, os, subprocess, sys

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FRASES = os.path.join(RAIZ, 'web', 'src', 'features', 'sandbox', 'audio', 'frases.json')
SALIDA = os.path.join(RAIZ, 'web', 'public', 'audio', 'voz')
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')
RECORTE = ('silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.03,areverse,'
           'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.06,areverse')


def valores(rangos):
    for a, b, paso in rangos:
        yield from range(a, b + 1, paso)


def trabajos(cat):
    for lang in ('es', 'en'):
        for clave, f in cat['estaticas'].items():
            yield lang, clave, f[lang]
        for clave, f in cat['numericas'].items():
            for n in valores(f['valores']):
                yield lang, f'{clave}_{n}', f[lang].replace('{n}', str(n))


def duracion(ruta):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ruta],
                       capture_output=True, text=True)
    try:
        return round(float(r.stdout.strip()), 3)
    except ValueError:
        return None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--forzar', action='store_true')
    ap.add_argument('--hilos', type=int, default=6)
    a = ap.parse_args()
    import edge_tts

    cat = json.load(open(FRASES, encoding='utf-8'))
    voces = cat['voces']
    sem = asyncio.Semaphore(a.hilos)
    fallas = []

    async def uno(lang, clave, texto):
        ruta = os.path.join(CACHE, lang, clave + '.mp3')
        if os.path.exists(ruta) and os.path.getsize(ruta) > 0 and not a.forzar:
            return
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        async with sem:
            for intento in range(3):
                try:
                    await edge_tts.Communicate(texto, voces[lang], rate='-4%').save(ruta + '.tmp')
                    os.replace(ruta + '.tmp', ruta)
                    return
                except Exception as e:  # red caída, límite del servicio…
                    err = e
                    await asyncio.sleep(1 + intento)
            fallas.append((lang, clave, str(err)))

    lista = list(trabajos(cat))
    await asyncio.gather(*(uno(*t) for t in lista))

    manifest = {'version': 1, 'voces': voces, 'es': {}, 'en': {}}
    for lang, clave, _ in lista:
        crudo = os.path.join(CACHE, lang, clave + '.mp3')
        ruta = os.path.join(SALIDA, lang, clave + '.mp3')
        if not os.path.exists(crudo):
            continue
        if a.forzar or not os.path.exists(ruta) or os.path.getmtime(ruta) < os.path.getmtime(crudo):
            os.makedirs(os.path.dirname(ruta), exist_ok=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', crudo, '-af', RECORTE, '-ac', '1', '-ar', '24000',
                            '-b:a', '32k', ruta], check=True)
        if os.path.exists(ruta):
            d = duracion(ruta)
            if d:
                manifest[lang][clave] = d
    with open(os.path.join(SALIDA, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))
    print(f'clips: {len(manifest["es"])} es, {len(manifest["en"])} en · fallas: {len(fallas)}')
    for x in fallas[:10]:
        print('  falla', *x)
    return 1 if fallas else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
