// Búsquedas reales contra Photon / Open-Meteo / Nominatim. Solo con BUSCAR_RED=1 (pide internet):
//   BUSCAR_RED=1 npx vitest run src/views/inicio/lugar.red.test.ts
import { describe, it, expect } from 'vitest'
import { buscarLugares } from './lugar'

const red = process.env.BUSCAR_RED === '1'
const locales = [
  { id: 'gt-jocotan', nombre: 'Jocotán', departamento: 'Chiquimula', lat: 14.82, lon: -89.39 },
  { id: 'gt-guatemala', nombre: 'Guatemala', departamento: 'Guatemala', lat: 14.62, lon: -90.53 },
]
const ver = (r: Awaited<ReturnType<typeof buscarLugares>>) =>
  r.lugares.map((l) => `${l.nombre} · ${l.detalle} [${l.tipo}|${l.fuente}|${l.nota}${l.aproximado ? '|aprox' : ''}]`).join('\n')

describe.skipIf(!red)('búsqueda exacta (red)', () => {
  it('Residencial San José Guatemala → una residencial en Guatemala', async () => {
    const r = await buscarLugares('Residencial San José Guatemala', 'es', undefined, { conNominatim: true, locales, paisPreferido: 'GT' })
    console.log(ver(r))
    expect(r.lugares[0].pais).toBe('GT')
    expect(r.lugares[0].nombre).toMatch(/San Jos/i)
  }, 30_000)
  it('Condominio Las Margaritas → el condominio exacto', async () => {
    const r = await buscarLugares('Condominio Las Margaritas', 'es', undefined, { conNominatim: true, locales, paisPreferido: 'GT' })
    console.log(ver(r))
    expect(r.lugares[0].nombre).toBe('Condominio Las Margaritas')
  }, 30_000)
  it('Aldea El Rosario Jocotán → exacto o, si no existe en los mapas, Jocotán para marcar a mano', async () => {
    const r = await buscarLugares('Aldea El Rosario Jocotán', 'es', undefined, { conNominatim: true, locales, paisPreferido: 'GT' })
    console.log(ver(r))
    const l = r.lugares[0]
    expect(l.aproximado ? l.nombre : l.nombre.includes('Rosario') ? 'ok' : '').toMatch(/Jocot|ok/)
  }, 30_000)
  it('ciudades siguen saliendo (Nairobi, Coatepeque)', async () => {
    for (const q of ['Nairobi', 'Coatepeque']) {
      const r = await buscarLugares(q, 'es', undefined, { locales })
      console.log(ver(r))
      expect(r.lugares[0].nombre).toBe(q)
    }
  }, 30_000)
})
