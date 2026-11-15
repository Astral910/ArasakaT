// Web Worker: calcula los mapas del suelo fuera del hilo principal (no traba la animación de carga).
import { calcularSuelo, type EntradaCalculo } from './calculo'

self.onmessage = (ev: MessageEvent<{ id: number; e: EntradaCalculo }>) => {
  const { id, e } = ev.data
  try {
    const s = calcularSuelo(e)
    const tr = [s.splatA.buffer, s.splatB.buffer, s.clase.buffer, s.agua.buffer, s.tipoAgua.buffer, s.nivel.buffer, s.alturas.buffer, s.fondo.buffer]
    ;(self as unknown as Worker).postMessage({ id, s }, tr as Transferable[])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
