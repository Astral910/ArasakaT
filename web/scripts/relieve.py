"""Genera el relieve real de Guatemala (SRTM via AWS Terrain Tiles, formato terrarium)
para el fondo de la landing, y los contornos de Guatemala y Jocotán.
Uso: python scripts/relieve.py   (salida en public/img y public/geo)"""
import io, json, math, os
import numpy as np, requests
from PIL import Image, ImageDraw, ImageFilter

Z = 9
LON0, LON1, LAT0, LAT1 = -92.4, -88.1, 13.6, 18.0
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

def tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

x0, y0 = tile(LON0, LAT1, Z); x1, y1 = tile(LON1, LAT0, Z)
tx = range(int(x0), int(x1) + 1); ty = range(int(y0), int(y1) + 1)
H = np.zeros((len(ty) * 256, len(tx) * 256), np.float32)
for j, y in enumerate(ty):
    for i, x in enumerate(tx):
        r = requests.get(URL.format(z=Z, x=x, y=y), timeout=30); r.raise_for_status()
        a = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB")).astype(np.float32)
        H[j*256:(j+1)*256, i*256:(i+1)*256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
# recorte exacto
px0 = int((x0 - tx[0]) * 256); py0 = int((y0 - ty[0]) * 256)
px1 = int((x1 - tx[0]) * 256); py1 = int((y1 - ty[0]) * 256)
H = H[py0:py1, px0:px1]
H[H < 0] = 0
h, w = H.shape

def to_px(lon, lat):
    X, Y = tile(lon, lat, Z)
    return (X - x0) * 256, (Y - y0) * 256

# sombreado (luz desde el noroeste)
lat_c = math.radians(15.5)
cell = 40075016 * math.cos(lat_c) / (256 * 2 ** Z)
gy, gx = np.gradient(H, cell)
gx *= 2.2; gy *= 2.2
slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
az, alt = math.radians(315), math.radians(42)
shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
shade = np.clip(shade, 0, 1)

# máscara del país desde los municipios
g = json.load(open("../data/municipios.geojson", encoding="utf-8"))
mask = Image.new("L", (w, h), 0); d = ImageDraw.Draw(mask)
for f in g["features"]:
    geom = f["geometry"]; polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        d.polygon([to_px(*p) for p in poly[0]], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(1.2))
M = np.asarray(mask).astype(np.float32) / 255

# color: tierra baja → verde milpa → hueso en altura
e = np.clip(H / 3800, 0, 1)
stops = np.array([[0, 0.38, 0.44, 0.30], [0.25, 0.55, 0.52, 0.36], [0.55, 0.66, 0.55, 0.40], [1, 0.93, 0.89, 0.82]])
col = np.stack([np.interp(e, stops[:, 0], stops[:, k]) for k in (1, 2, 3)], -1)
lit = col * (0.45 + 0.75 * shade[..., None])
rgb = np.clip(lit * 255, 0, 255).astype(np.uint8)
rgba = np.dstack([rgb, (M * 255).astype(np.uint8)])
img = Image.fromarray(rgba, "RGBA")
img.save("public/img/relieve-gt.webp", quality=82, method=6)
# versión en gris (para modo oscuro y fondos tenues)
gray = np.clip((0.35 + 0.8 * shade) * 255, 0, 255).astype(np.uint8)
Image.fromarray(np.dstack([gray, gray, gray, (M * 255).astype(np.uint8)]), "RGBA").save("public/img/relieve-gt-gris.webp", quality=80, method=6)
print("relieve", w, h, "max m", H.max())

# posiciones relativas de Jocotán para el marcador de la landing
jx, jy = to_px(-89.39, 14.82)
json.dump({"w": w, "h": h, "jocotan": [jx / w, jy / h]}, open("public/img/relieve-gt.json", "w"))

