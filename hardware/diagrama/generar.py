# Genera diagrama.svg: cableado del nodo ESP32-C3 de la estación de campo.
# Uso: python hardware/diagrama/generar.py   (sale junto a este archivo)
import os

W, H = 1400, 880
C = {'vbat': '#d7263d', 'v33': '#f18f01', 'sw': '#c2187a', 'gnd': '#1d1d1b', 'adc': '#d4a000', 'sda': '#2e6fd8',
     'scl': '#2a9d5c', 'ow': '#8d8d8d', 'reed': '#7b4fc9', 'gate': '#8a5a3b', 'sol': '#ff6b35'}
o = []
a = o.append


def box(x, y, w, h, t, sub='', fill='#fffaf2', stroke='#57473a'):
    a(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
    a(f'<text x="{x + w / 2}" y="{y + 24}" text-anchor="middle" font-size="16" font-weight="700" fill="#2a2118">{t}</text>')
    for i, s in enumerate(sub.split('|') if sub else []):
        a(f'<text x="{x + w / 2}" y="{y + 44 + i * 17}" text-anchor="middle" font-size="12.5" fill="#57473a">{s}</text>')


def wire(pts, c, w=3.2):
    d = 'M' + ' L'.join(f'{x},{y}' for x, y in pts)
    a(f'<path d="{d}" fill="none" stroke="{C[c]}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>')


def dot(x, y, c):
    a(f'<circle cx="{x}" cy="{y}" r="4.5" fill="{C[c]}"/>')


def lab(x, y, t, anchor='start', col='#2a2118', sz=12.5, w='600'):
    a(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{sz}" font-weight="{w}" fill="{col}">{t}</text>')


def res(x, y, t, vert=False):
    if vert:
        a(f'<rect x="{x - 7}" y="{y - 18}" width="14" height="36" rx="3" fill="#e9d8b8" stroke="#57473a"/>')
        lab(x + 12, y + 4, t, 'start', '#57473a', 12, '700')
    else:
        a(f'<rect x="{x - 18}" y="{y - 7}" width="36" height="14" rx="3" fill="#e9d8b8" stroke="#57473a"/>')
        lab(x, y - 12, t, 'middle', '#57473a', 12, '700')


def cap(x, y, t, anchor='start'):
    a(f'<rect x="{x - 12}" y="{y - 5}" width="24" height="10" fill="#cfd8dc" stroke="#57473a"/>')
    lab(x + (18 if anchor == 'start' else -18), y + 4, t, anchor, '#57473a', 11, '600')


a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Figtree, system-ui, sans-serif">')
a('<rect width="100%" height="100%" fill="#f5efe4"/>')
a('<text x="40" y="52" font-family="Fraunces, Georgia, serif" font-size="30" font-weight="600" fill="#2a2118">Estación de campo FieldShift · cableado del nodo ESP32-C3</text>')
a('<text x="40" y="80" font-size="15" fill="#7d6a58">Sensores alimentados solo al medir (P-MOSFET) · deep sleep 15 min · el reed del pluviómetro despierta al chip · analógicos solo en ADC1</text>')

# energía
box(40, 120, 200, 92, 'Panel solar 6 V', '1–2 W · inclinado ≈ latitud (≥ 15°)|mirando al ecuador', fill='#e8eef7')
box(40, 290, 200, 110, 'Cargador CN3065', '(o TP4056 con DW01)|IN+/IN− ← panel|BAT+/BAT− → 18650')
box(40, 480, 200, 92, 'Batería 18650', '3,0–4,2 V · con protección|2 500–3 500 mAh')
box(320, 290, 180, 110, 'LDO 3,3 V', 'RT9080-33 (Iq ≈ 2 µA)|o HT7333 + 470 µF|VIN ← BAT+ · VOUT → 3V3')
wire([(150, 212), (150, 290)], 'sol'); lab(160, 255, 'IN+ (naranja)')
wire([(110, 212), (110, 290)], 'gnd')
wire([(110, 400), (110, 480)], 'gnd'); wire([(170, 400), (170, 480)], 'vbat'); lab(180, 445, 'BAT+')
wire([(240, 320), (320, 320)], 'vbat'); lab(250, 312, 'BAT+ (rojo)')
wire([(240, 380), (320, 380)], 'gnd'); lab(250, 372, 'GND (negro)')

# MCU
box(600, 190, 250, 400, 'ESP32-C3', 'SuperMini / DevKitM-1', stroke='#2a2118')
pins = [('3V3', 230, 'v33'), ('GND', 262, 'gnd'), ('GPIO0 · ADC1_CH0', 300, 'adc'), ('GPIO1 · ADC1_CH1', 335, 'adc'),
        ('GPIO3 · ADC1_CH3', 370, 'adc'), ('GPIO4 · despierta', 405, 'reed'), ('GPIO5 · MOSFET', 440, 'gate'),
        ('GPIO6 · SDA', 475, 'sda'), ('GPIO7 · SCL', 510, 'scl'), ('GPIO10 · 1-Wire', 545, 'ow')]
for n, y, c in pins:
    a(f'<rect x="842" y="{y - 7}" width="16" height="14" rx="3" fill="{C[c]}"/>')
    lab(832, y + 4, n, 'end', '#2a2118', 13, '600')
lab(725, 575, 'Quitá el LED rojo de encendido: gasta ~1 mA', 'middle', '#b5343c', 11.5, '700')

# 3V3 y GND desde el LDO
wire([(500, 320), (560, 320), (560, 230), (842, 230)], 'v33'); lab(505, 312, '3V3 fijo (naranja)')
wire([(500, 380), (575, 380), (575, 262), (842, 262)], 'gnd')

# divisor de batería
wire([(280, 320), (280, 620), (432, 620)], 'vbat')
res(450, 620, '220 kΩ'); wire([(468, 620), (532, 620)], 'vbat', 2)
res(550, 620, '220 kΩ'); wire([(568, 620), (590, 620), (590, 660)], 'gnd', 2)
dot(500, 620, 'adc'); wire([(500, 620), (500, 690), (905, 690), (905, 370), (858, 370)], 'adc')
cap(500, 650, '100 nF')
lab(300, 720, 'Vbat = Vadc × 2 (divisor 220k/220k + 100 nF, ≈ 9,5 µA)', 'start', '#7d6a58', 12, '600')

# P-MOSFET
box(960, 140, 200, 96, 'P-MOSFET AO3401', 'S ← 3V3 fijo · D → 3V3 sens.|G ← GPIO5 · 100 kΩ de G a S', fill='#f3e6ef')
wire([(858, 440), (930, 440), (930, 205), (960, 205)], 'gate'); lab(866, 432, 'compuerta (marrón)')
wire([(560, 230), (560, 165), (960, 165)], 'v33')
wire([(1160, 190), (1210, 190), (1210, 640)], 'sw', 3.6)
lab(1166, 260, '3V3 sensores', 'start', C['sw'], 13, '700'); lab(1166, 276, '(solo al medir)', 'start', C['sw'], 12, '600')

# GND común
wire([(575, 262), (575, 810), (1330, 810), (1330, 300)], 'gnd'); lab(600, 830, 'GND común (negro)')

# sensores
sx = 1240
for y, t, s, f in [(290, 'Capacitivo 10 cm', 'VCC · GND · AOUT', '#eef5ea'), (380, 'Capacitivo 30 cm', 'VCC · GND · AOUT', '#eef5ea'),
                   (470, 'SHT31 (abrigo)', 'VIN GND SDA SCL · 0x44', '#eef5ea'), (560, 'DS18B20', 'sumergible · suelo|rojo VDD · negro GND|amarillo DATA', '#eef5ea'),
                   (680, 'Reed pluviómetro', 'normal abierto · a GND|imán 6×3 mm|en el balancín', '#ede7f6')]:
    box(sx, y, 150, 70 if y < 560 else 84, t, s, fill=f)
for y in (304, 394, 484, 574):
    wire([(1210, y), (sx, y)], 'sw', 2.4)
for y in (318, 408, 498, 590, 750):
    wire([(1330, y), (sx + 150, y)], 'gnd', 2)
wire([(858, 300), (1000, 300), (1000, 340), (sx, 340)], 'adc'); lab(1008, 334, 'AOUT 10 cm (amarillo)')
wire([(858, 335), (985, 335), (985, 430), (sx, 430)], 'adc'); lab(1008, 424, 'AOUT 30 cm (amarillo)')
wire([(858, 475), (1080, 475), (1080, 515), (sx, 515)], 'sda'); lab(1088, 509, 'SDA (azul)')
wire([(858, 510), (1065, 510), (1065, 530), (sx, 530)], 'scl'); lab(1088, 548, 'SCL (verde)')
wire([(858, 545), (1050, 545), (1050, 615), (sx, 615)], 'ow'); lab(1058, 608, 'DATA (gris)')
res(1150, 590, '4,7 kΩ', True); wire([(1150, 572), (1150, 560), (1210, 560)], 'sw', 2); wire([(1150, 608), (1150, 615)], 'ow', 2)
wire([(858, 405), (945, 405), (945, 725), (sx, 725)], 'reed'); lab(953, 718, 'reed (violeta)')
dot(945, 760, 'reed'); wire([(945, 725), (945, 760)], 'reed', 2)
res(1000, 760, '100 kΩ'); wire([(945, 760), (982, 760)], 'reed', 2)
wire([(1018, 760), (1060, 760), (1060, 785), (545, 785), (545, 320), (560, 320)], 'v33', 2)
lab(1068, 778, 'pull-up al 3V3 fijo', 'start', '#57473a', 11, '600')
cap(900, 760, '100 nF a GND', 'end')

# leyenda
lx, ly = 40, 600
a(f'<rect x="{lx}" y="{ly}" width="230" height="230" rx="12" fill="#fffaf2" stroke="#57473a" stroke-width="1"/>')
lab(lx + 16, ly + 26, 'Colores de cable', 'start', '#2a2118', 15, '700')
leg = [('vbat', 'Batería +'), ('v33', '3,3 V fijo'), ('sw', '3,3 V sensores'), ('gnd', 'GND'), ('adc', 'Analógico (ADC1)'),
       ('sda', 'I²C SDA'), ('scl', 'I²C SCL'), ('ow', '1-Wire'), ('reed', 'Reed'), ('gate', 'Compuerta'), ('sol', 'Panel +')]
for i, (c, t) in enumerate(leg):
    yy = ly + 50 + (i % 6) * 29
    xx = lx + 16 + (i // 6) * 110
    a(f'<line x1="{xx}" y1="{yy}" x2="{xx + 22}" y2="{yy}" stroke="{C[c]}" stroke-width="5" stroke-linecap="round"/>')
    lab(xx + 28, yy + 4, t, 'start', '#2a2118', 11.5, '600')
a('</svg>')

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'diagrama.svg'), 'w', encoding='utf8') as f:
    f.write('\n'.join(o))
print('diagrama.svg listo')
